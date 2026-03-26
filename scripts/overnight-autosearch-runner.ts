import { globSync, readFileSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { agentLoop, estimateCost, ToolRegistry } from "@takumi/agent";
import { loadConfig } from "@takumi/core";
import { probeOllama, tryResolveCliToken } from "../bin/cli/cli-auth.js";
import {
	buildFocusPlan,
	buildResearchPrompt,
	buildSynthesisPrompt,
	extractFindingHeadlines,
	type OvernightAutosearchOptions,
	type ResearchIterationResult,
	type ResearchPaths,
	resolveResearchPaths,
} from "../bin/cli/overnight-autosearch-shared.js";
import { buildSingleProvider } from "../bin/cli/provider.js";
import { buildCliCandidates, filterHealthyCliCandidates, runCliAudit } from "./overnight-autosearch-cli.js";

interface ProviderCandidate {
	provider: string;
	apiKey?: string;
	model?: string;
}

interface FocusSpec {
	anchorFiles: string[];
	globs: string[];
	searches: Array<{ pattern: string; glob?: string }>;
}

interface AuditProvider {
	sendMessage: (
		messages: Array<{ role: "user" | "assistant"; content: unknown }>,
		system: string,
		toolDefs?: unknown[],
		signal?: AbortSignal,
		options?: { model?: string },
	) => AsyncIterable<{ type: string; [key: string]: unknown }>;
}

type AuditOutput = Pick<ResearchIterationResult, "text" | "toolUses" | "inputTokens" | "outputTokens" | "costUsd">;

function selectCliCandidates(
	cliCandidates: ReturnType<typeof buildCliCandidates>,
): ReturnType<typeof buildCliCandidates> {
	return [...cliCandidates].sort((left, right) => {
		if (left.id === right.id) return 0;
		if (left.id === "codex") return -1;
		if (right.id === "codex") return 1;
		return 0;
	});
}

function buildAutosearchSystemPrompt(cwd: string): string {
	return [
		"You are Takumi's repository review assistant.",
		`Working directory: ${cwd}`,
		"You are in strict read-only mode.",
		"Repository evidence is already gathered locally before each prompt.",
		"Ground every finding in that evidence only. Do not pretend to inspect anything else.",
	].join("\n");
}

function isAuthFailure(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /api key|auth|unauthorized|forbidden|invalid/i.test(message);
}

async function ensureParentDir(filePath: string): Promise<void> {
	await mkdir(dirname(filePath), { recursive: true });
}

function buildApiEnvCandidates(explicitModel?: string): ProviderCandidate[] {
	const env = process.env;
	const candidates: Array<ProviderCandidate | null> = [
		env.ANTHROPIC_API_KEY ? { provider: "anthropic", apiKey: env.ANTHROPIC_API_KEY, model: explicitModel } : null,
		env.CLAUDE_CODE_OAUTH_TOKEN ? { provider: "anthropic", apiKey: env.CLAUDE_CODE_OAUTH_TOKEN, model: explicitModel } : null,
		env.OPENAI_API_KEY ? { provider: "openai", apiKey: env.OPENAI_API_KEY, model: explicitModel ?? "gpt-4o-mini" } : null,
		env.GITHUB_TOKEN ? { provider: "github", apiKey: env.GITHUB_TOKEN, model: explicitModel ?? "gpt-4o-mini" } : null,
		env.GEMINI_API_KEY ? { provider: "gemini", apiKey: env.GEMINI_API_KEY, model: explicitModel ?? "gemini-2.5-flash" } : null,
		env.GOOGLE_API_KEY ? { provider: "gemini", apiKey: env.GOOGLE_API_KEY, model: explicitModel ?? "gemini-2.5-flash" } : null,
		env.TAKUMI_API_KEY ? { provider: "anthropic", apiKey: env.TAKUMI_API_KEY, model: explicitModel } : null,
	];
	return candidates.filter((candidate): candidate is ProviderCandidate => candidate !== null);
}

function focusSpecFor(focus: string): FocusSpec {
	if (focus.includes("architecture")) {
		return {
			anchorFiles: ["AGENTS.md", "CLAUDE.md", "README.md", "docs/ARCHITECTURE.md", "docs/packages.md"],
			globs: ["packages/*/src/*.ts", "packages/*/package.json", "bin/**/*.ts"],
			searches: [
				{ pattern: "@takumi/", glob: "*.ts" },
				{ pattern: "package dependency order|dependency order|boundary", glob: "*.md" },
			],
		};
	}
	if (focus.includes("CLI") || focus.includes("tmux") || focus.includes("terminal")) {
		return {
			anchorFiles: ["README.md", "docs/KEYBINDINGS.md", "bin/takumi.ts", "bin/cli/platform.ts", "bin/cli/one-shot.ts"],
			globs: ["bin/cli/*.ts", "packages/tui/src/*.ts"],
			searches: [
				{ pattern: "tmux|ghostty|terminal|headless|detach", glob: "*.ts" },
				{ pattern: "tmux|keybind|detach", glob: "*.md" },
			],
		};
	}
	if (focus.includes("desktop") || focus.includes("macOS")) {
		return {
			anchorFiles: ["apps/desktop/src/App.tsx", "apps/desktop/src/styles.css", "apps/desktop/package.json"],
			globs: ["apps/desktop/src/**/*.{ts,tsx,css}"],
			searches: [
				{ pattern: "sidebar|resize|shortcut|submit|stream", glob: "*.tsx" },
				{ pattern: "mac|desktop|ghostty", glob: "*.md" },
			],
		};
	}
	if (focus.includes("test") || focus.includes("validation")) {
		return {
			anchorFiles: ["package.json", "vitest.config.ts", "TODO.md"],
			globs: ["packages/*/test/*.test.ts", "bin/test/*.test.ts"],
			searches: [
				{ pattern: "describe\\(|it\\(", glob: "*.test.ts" },
				{ pattern: "TODO|coverage|hidden tests|validate", glob: "*.md" },
			],
		};
	}
	if (focus.includes("docs") || focus.includes("onboarding")) {
		return {
			anchorFiles: ["README.md", "docs/README.md", "AGENTS.md", "TODO.md"],
			globs: ["docs/**/*.md", "*.md"],
			searches: [
				{ pattern: "install|setup|usage|example|workflow", glob: "*.md" },
				{ pattern: "TODO|FIXME|TBD", glob: "*.md" },
			],
		};
	}
	return {
		anchorFiles: ["README.md", "TODO.md", "package.json", "AGENTS.md"],
		globs: ["packages/*/src/*.ts", "packages/*/test/*.test.ts", "docs/**/*.md"],
		searches: [
			{ pattern: "TODO|FIXME|HACK|XXX", glob: "*.{ts,tsx,md}" },
			{ pattern: "error|retry|timeout|budget|telemetry", glob: "*.ts" },
		],
	};
}

function unique<T>(items: T[]): T[] {
	return [...new Set(items)];
}

function readSnippet(filePath: string, maxLines = 24): string {
	try {
		const lines = readFileSync(filePath, "utf-8").split("\n").slice(0, maxLines);
		return lines.map((line, index) => `${index + 1}\t${line}`).join("\n");
	} catch {
		return "[unreadable]";
	}
}

function runRipgrep(cwd: string, pattern: string, glob?: string, maxResults = 8): string[] {
	const args = ["--line-number", "--no-heading", "--color=never", "-m", String(maxResults)];
	if (glob) args.push("--glob", glob);
	args.push(pattern, cwd);
	const result = spawnSync("rg", args, { cwd, encoding: "utf-8", timeout: 20_000, maxBuffer: 1024 * 1024 });
	if (result.status && result.status > 1) return [];
	return (result.stdout || "")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.slice(0, maxResults);
}

function collectFocusEvidence(cwd: string, focus: string): string {
	const spec = focusSpecFor(focus);
	const evidenceSections: string[] = [];
	const files = unique([
		...spec.anchorFiles,
		...spec.globs.flatMap((pattern) => globSync(pattern, { cwd }).slice(0, 4)),
	]).slice(0, 6);

	for (const relativePath of files) {
		evidenceSections.push(`### File: ${relativePath}\n${readSnippet(`${cwd}/${relativePath}`)}`);
	}

	for (const search of spec.searches.slice(0, 3)) {
		const matches = runRipgrep(cwd, search.pattern, search.glob, 6);
		if (matches.length > 0) {
			evidenceSections.push(`### Search: ${search.pattern}${search.glob ? ` (${search.glob})` : ""}\n${matches.join("\n")}`);
		}
	}

	return evidenceSections.join("\n\n").slice(0, 6000);
}

function buildEvidencePrompt(basePrompt: string, evidence: string): string {
	return [basePrompt, "", "Repository evidence collected locally:", evidence || "[no evidence collected]"]
		.join("\n")
		.slice(0, 7200);
}

async function buildProviderCandidates(baseConfig: ReturnType<typeof loadConfig>, explicitModel?: string): Promise<ProviderCandidate[]> {
	const candidates: ProviderCandidate[] = [{ provider: baseConfig.provider || "anthropic", model: explicitModel ?? baseConfig.model }];
	const pushCandidate = (candidate: ProviderCandidate | null) => {
		if (!candidate) return;
		if (candidates.some((existing) => existing.provider === candidate.provider)) return;
		candidates.push(candidate);
	};

	const anthropicCli = tryResolveCliToken("anthropic");
	pushCandidate(anthropicCli ? { provider: "anthropic", apiKey: anthropicCli, model: explicitModel ?? baseConfig.model } : null);

	const githubCli = tryResolveCliToken("github");
	pushCandidate(githubCli ? { provider: "github", apiKey: githubCli, model: explicitModel ?? "gpt-4o-mini" } : null);

	const openAiCli = tryResolveCliToken("openai");
	pushCandidate(openAiCli ? { provider: "openai", apiKey: openAiCli, model: explicitModel ?? "gpt-4o-mini" } : null);

	const geminiCli = tryResolveCliToken("gemini");
	pushCandidate(geminiCli ? { provider: "gemini", apiKey: geminiCli, model: explicitModel ?? "gemini-2.5-flash" } : null);

	for (const candidate of buildApiEnvCandidates(explicitModel ?? baseConfig.model)) {
		pushCandidate(candidate);
	}

	const ollamaModels = await probeOllama();
	pushCandidate(ollamaModels.length > 0 ? { provider: "ollama", model: explicitModel ?? ollamaModels[0] } : null);

	return candidates;
}

async function createProviderFromCandidates(
	baseConfig: ReturnType<typeof loadConfig>,
	agent: typeof import("@takumi/agent"),
	explicitModel?: string,
): Promise<{ candidates: ProviderCandidate[]; startIndex: number; provider: AuditProvider }> {
	const candidates = await buildProviderCandidates(baseConfig, explicitModel);
	for (const [index, candidate] of candidates.entries()) {
		const candidateConfig = {
			...baseConfig,
			provider: candidate.provider,
			...(candidate.apiKey ? { apiKey: candidate.apiKey } : {}),
			model: candidate.model ?? explicitModel ?? baseConfig.model,
		};
		const provider = await buildSingleProvider(candidate.provider, candidateConfig, agent);
		if (provider) {
			return { candidates, startIndex: index, provider: provider as AuditProvider };
		}
	}

	throw new Error("Unable to create provider for overnight autosearch. Check .env, CLI auth, or local model availability.");
}

function createAgentTools(): ToolRegistry {
	return new ToolRegistry();
}

async function runSingleAudit(params: {
	cwd: string;
	model?: string;
	maxTurns: number;
	prompt: string;
	provider: AuditProvider;
}): Promise<AuditOutput> {
	const systemPrompt = buildAutosearchSystemPrompt(params.cwd);
	let text = "";
	const toolUses: string[] = [];
	let inputTokens = 0;
	let outputTokens = 0;
	let costUsd = 0;

	const loop = agentLoop(params.prompt, [], {
		sendMessage: (messages, system, toolDefs, signal, options) => {
			return params.provider.sendMessage(messages, system, toolDefs, signal, options) as AsyncIterable<any>;
		},
		tools: createAgentTools(),
		systemPrompt,
		maxTurns: params.maxTurns,
		model: params.model,
	});

	for await (const event of loop) {
		if (event.type === "text_delta" && typeof event.text === "string") {
			text += event.text;
			continue;
		}
		if (event.type === "usage_update" && event.usage) {
			const usage = event.usage as { inputTokens: number; outputTokens: number };
			inputTokens = usage.inputTokens;
			outputTokens = usage.outputTokens;
			costUsd = estimateCost(inputTokens, outputTokens, params.model ?? "unknown");
			continue;
		}
		if (event.type === "error") {
			const errorMessage = event.error instanceof Error ? event.error.message : String(event.error ?? "Unknown error");
			throw new Error(errorMessage);
		}
	}
	return { text: text.trim(), toolUses, inputTokens, outputTokens, costUsd };
}

async function writeReportHeader(paths: ResearchPaths, options: OvernightAutosearchOptions): Promise<void> {
	await ensureParentDir(paths.reportFile);
	await ensureParentDir(paths.rawLogFile);
	const header = [
		"# Takumi Overnight Autosearch Report",
		"",
		`- Started: ${new Date().toISOString()}`,
		`- Working directory: ${options.cwd}`,
		`- Planned hours: ${options.hours}`,
		`- Max iterations: ${options.maxIterations}`,
		`- Model override: ${options.model ?? "default config model"}`,
		"",
	].join("\n");
	await writeFile(paths.reportFile, `${header}\n`, "utf-8");
	await writeFile(paths.rawLogFile, "", "utf-8");
}

async function appendIteration(paths: ResearchPaths, result: ResearchIterationResult): Promise<void> {
	const section = [
		`## Iteration ${result.index} — ${result.focus}`,
		"",
		`- Started: ${result.startedAt}`,
		`- Completed: ${result.completedAt}`,
		`- Tools used: ${result.toolUses.length > 0 ? result.toolUses.join(", ") : "none"}`,
		`- Usage: in=${result.inputTokens}, out=${result.outputTokens}, cost≈$${result.costUsd.toFixed(4)}`,
		"",
		result.text,
		"",
	].join("\n");
	await appendFile(paths.reportFile, `${section}\n`, "utf-8");
	await appendFile(paths.rawLogFile, `${JSON.stringify(result)}\n`, "utf-8");
}

async function appendSynthesis(paths: ResearchPaths, synthesis: string): Promise<void> {
	await appendFile(paths.reportFile, `## Final Synthesis\n\n${synthesis.trim()}\n`, "utf-8");
}

export async function runOvernightAutosearch(options: OvernightAutosearchOptions): Promise<ResearchPaths> {
	const paths = resolveResearchPaths(options.cwd, options.reportFile);
	await writeReportHeader(paths, options);
	const cliCandidates = selectCliCandidates(filterHealthyCliCandidates(options.cwd, buildCliCandidates()));

	const config = loadConfig({
		workingDirectory: options.cwd,
		...(options.model ? { model: options.model } : {}),
	});
	const agent = await import("@takumi/agent");
	const providerState = await (async () => {
		try {
			return await createProviderFromCandidates(config, agent, options.model);
		} catch {
			return null;
		}
	})();
	let activeProviderIndex = providerState?.startIndex ?? 0;
	let provider = providerState?.provider;

	const priorFindings: string[] = [];
	const iterations: ResearchIterationResult[] = [];
	const plan = buildFocusPlan(options.maxIterations);
	const deadline = Date.now() + options.hours * 60 * 60 * 1000;

	for (const [index, focus] of plan.entries()) {
		if (Date.now() >= deadline) break;
		const startedAt = new Date().toISOString();
		const prompt = buildResearchPrompt({
			focus,
			iteration: index + 1,
			previousFindings: priorFindings,
			deadlineHours: options.hours,
		});
		const evidence = collectFocusEvidence(options.cwd, focus);
		const groundedPrompt = buildEvidencePrompt(prompt, evidence);
		let output: AuditOutput | null = null;
		if (cliCandidates.length > 0) {
			let lastCliError: Error | null = null;
			for (const cliCandidate of cliCandidates) {
				try {
					output = runCliAudit({ cwd: options.cwd, prompt: groundedPrompt, candidate: cliCandidate });
					lastCliError = null;
					break;
				} catch (error) {
					lastCliError = error instanceof Error ? error : new Error(String(error));
				}
			}
			if (!output && provider) {
				output = await runSingleAudit({
					cwd: options.cwd,
					model: options.model,
					maxTurns: options.maxTurns,
					prompt: groundedPrompt,
					provider,
				});
			}
			if (lastCliError && !output) throw lastCliError;
		} else {
			try {
				output = await runSingleAudit({
					cwd: options.cwd,
					model: options.model,
					maxTurns: options.maxTurns,
					prompt: groundedPrompt,
					provider: provider!,
				});
			} catch (error) {
				if (!isAuthFailure(error) || !providerState) throw error;
				const nextCandidate = providerState.candidates[activeProviderIndex + 1];
				if (!nextCandidate) throw error;
				const nextConfig = {
					...config,
					provider: nextCandidate.provider,
					...(nextCandidate.apiKey ? { apiKey: nextCandidate.apiKey } : {}),
					model: nextCandidate.model ?? options.model ?? config.model,
				};
				const nextProvider = await buildSingleProvider(nextCandidate.provider, nextConfig, agent);
				if (!nextProvider) throw error;
				activeProviderIndex += 1;
				provider = nextProvider as AuditProvider;
				output = await runSingleAudit({
					cwd: options.cwd,
					model: options.model,
					maxTurns: options.maxTurns,
					prompt: groundedPrompt,
					provider,
				});
			}
		}
		if (!output) {
			throw new Error(`No audit output generated for focus: ${focus}`);
		}
		const completedAt = new Date().toISOString();
		const result: ResearchIterationResult = {
			index: index + 1,
			focus,
			text: output.text,
			toolUses: output.toolUses,
			inputTokens: output.inputTokens,
			outputTokens: output.outputTokens,
			costUsd: output.costUsd,
			startedAt,
			completedAt,
		};
		iterations.push(result);
		priorFindings.push(...extractFindingHeadlines(output.text));
		if (priorFindings.length > 24) {
			priorFindings.splice(0, priorFindings.length - 24);
		}
		await appendIteration(paths, result);
	}

	if (iterations.length > 0) {
		const synthesisPrompt = buildSynthesisPrompt(iterations);
		let synthesis: AuditOutput | null = null;
		if (cliCandidates.length > 0) {
			for (const cliCandidate of cliCandidates) {
				try {
					synthesis = runCliAudit({ cwd: options.cwd, prompt: synthesisPrompt, candidate: cliCandidate });
					break;
				} catch {
					// Try the next local CLI, then provider fallback.
				}
			}
		}
		if (!synthesis) {
			synthesis = await runSingleAudit({
				cwd: options.cwd,
				model: options.model,
				maxTurns: options.maxTurns,
				prompt: synthesisPrompt,
				provider: provider!,
			});
		}
		await appendSynthesis(paths, synthesis.text);
	}

	return paths;
}
