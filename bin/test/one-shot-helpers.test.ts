import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactStore, resetArtifactCounter } from "@takumi/core";
import {
	buildHubArtifacts,
	dedupeFiles,
	determineExecCapability,
	type ExecArtifactBridge,
	extractSelectedModel,
	extractSelectedProvider,
	isPolicyFailureOutput,
	normalizeExecProviderFamily,
	resolveExecConcreteProvider,
	persistExecArtifacts,
} from "../cli/one-shot-helpers.js";

describe("one-shot-helpers", () => {
	describe("determineExecCapability", () => {
		it("returns review for review-like prompts", () => {
			expect(determineExecCapability("review this code")).toBe("coding.review.strict");
			expect(determineExecCapability("security audit")).toBe("coding.review.strict");
			expect(determineExecCapability("validate the PR")).toBe("coding.review.strict");
		});

		it("returns deep-reasoning for complex prompts", () => {
			expect(determineExecCapability("refactor the auth module")).toBe("coding.deep-reasoning");
			expect(determineExecCapability("design the new API")).toBe("coding.deep-reasoning");
			expect(determineExecCapability("a".repeat(801))).toBe("coding.deep-reasoning");
		});

		it("returns patch-cheap for simple prompts", () => {
			expect(determineExecCapability("fix the typo")).toBe("coding.patch-cheap");
			expect(determineExecCapability("add a log line")).toBe("coding.patch-cheap");
		});
	});

	describe("normalizeExecProviderFamily", () => {
		it("normalizes known providers", () => {
			expect(normalizeExecProviderFamily("anthropic")).toBe("anthropic");
			expect(normalizeExecProviderFamily("openai")).toBe("openai");
			expect(normalizeExecProviderFamily("google")).toBe("google");
			expect(normalizeExecProviderFamily("gemini")).toBe("google");
		});

		it("maps compat providers to openai-compat", () => {
			for (const p of ["openai-compat", "openrouter", "ollama", "github", "groq", "deepseek", "mistral", "together"]) {
				expect(normalizeExecProviderFamily(p)).toBe("openai-compat");
			}
		});

		it("returns null for unknown or missing", () => {
			expect(normalizeExecProviderFamily(undefined)).toBeNull();
			expect(normalizeExecProviderFamily("unknown-provider")).toBeNull();
		});
	});

	describe("extractSelectedModel", () => {
		it("extracts model from metadata", () => {
			expect(extractSelectedModel({ model: "gpt-4" })).toBe("gpt-4");
		});

		it("extracts modelId from metadata", () => {
			expect(extractSelectedModel({ modelId: "claude-3.5" })).toBe("claude-3.5");
		});

		it("prefers model over modelId", () => {
			expect(extractSelectedModel({ model: "gpt-4", modelId: "claude-3.5" })).toBe("gpt-4");
		});

		it("returns undefined for missing metadata", () => {
			expect(extractSelectedModel(undefined)).toBeUndefined();
			expect(extractSelectedModel({})).toBeUndefined();
		});
	});

	describe("extractSelectedProvider", () => {
		it("extracts provider ids from route metadata", () => {
			expect(extractSelectedProvider({ providerId: "openrouter" })).toBe("openrouter");
			expect(extractSelectedProvider({ provider: "google" })).toBe("gemini");
		});

		it("prefers providerId over generic provider fields", () => {
			expect(extractSelectedProvider({ providerId: "openai", provider: "google" })).toBe("openai");
		});

		it("returns undefined when metadata does not carry a concrete provider", () => {
			expect(extractSelectedProvider({ compatibleProvider: 42 })).toBeUndefined();
			expect(extractSelectedProvider(undefined)).toBeUndefined();
		});
	});

	describe("resolveExecConcreteProvider", () => {
		it("uses explicit route metadata when compat routes already carry a concrete provider", () => {
			expect(resolveExecConcreteProvider("openai-compat", "openrouter", "gpt-4.1", "anthropic")).toBe("openrouter");
		});

		it("falls back to the configured compat provider when the route family stays compat-only", () => {
			expect(resolveExecConcreteProvider("openai-compat", undefined, undefined, "openrouter")).toBe("openrouter");
		});

		it("refuses to guess a concrete compat provider from the model name alone", () => {
			expect(resolveExecConcreteProvider("openai-compat", undefined, "gpt-4.1", "anthropic")).toBeUndefined();
		});

		it("still infers concrete providers when the daemon omitted provider-family metadata entirely", () => {
			expect(resolveExecConcreteProvider(undefined, undefined, "gpt-4.1", "anthropic")).toBe("openai");
		});
	});

	describe("isPolicyFailureOutput", () => {
		it("detects headless permission denial", () => {
			expect(isPolicyFailureOutput("Headless run denied permission-required tool: write_file")).toBe(true);
		});

		it("detects permission denied", () => {
			expect(isPolicyFailureOutput("permission denied for tool execute")).toBe(true);
		});

		it("returns false for normal output", () => {
			expect(isPolicyFailureOutput("File written successfully")).toBe(false);
		});
	});

	describe("dedupeFiles", () => {
		it("deduplicates and sorts", () => {
			expect(dedupeFiles(["b.ts", "a.ts", "b.ts", ""])).toEqual(["a.ts", "b.ts"]);
		});

		it("handles empty input", () => {
			expect(dedupeFiles([])).toEqual([]);
		});
	});

	describe("buildHubArtifacts", () => {
		beforeEach(() => {
			resetArtifactCounter();
		});

		it("produces assistant_response artifact for non-empty text", () => {
			const artifacts = buildHubArtifacts({
				fullText: "Hello world",
				failures: [],
				routing: {
					capability: "coding.patch-cheap",
					authority: "takumi-fallback",
					enforcement: "capability-only",
					provider: "anthropic",
					model: "claude-3.5",
				},
				filesChanged: [],
			});

			const response = artifacts.find((a) => a.kind === "assistant_response");
			expect(response).toBeDefined();
			expect(response!.summary).toBe("Hello world");
			expect(response!.producer).toBe("takumi.exec");
		});

		it("produces postmortem artifact for failures", () => {
			const artifacts = buildHubArtifacts({
				fullText: "output",
				failures: ["tool_error: bad input"],
				routing: {
					capability: "coding.patch-cheap",
					authority: "takumi-fallback",
					enforcement: "capability-only",
					provider: "anthropic",
					model: "claude-3.5",
				},
				filesChanged: [],
			});

			const postmortem = artifacts.find((a) => a.kind === "postmortem");
			expect(postmortem).toBeDefined();
			expect(postmortem!.body).toBe("tool_error: bad input");
		});

		it("produces implementation artifact for changed files", () => {
			const artifacts = buildHubArtifacts({
				fullText: "done",
				failures: [],
				routing: {
					capability: "coding.patch-cheap",
					authority: "takumi-fallback",
					enforcement: "capability-only",
					provider: "anthropic",
					model: "claude-3.5",
				},
				filesChanged: ["src/index.ts", "src/utils.ts"],
			});

			const impl = artifacts.find((a) => a.kind === "implementation");
			expect(impl).toBeDefined();
			expect(impl!.summary).toBe("2 file(s) changed");
		});

		it("always produces exec_result artifact", () => {
			const artifacts = buildHubArtifacts({
				fullText: "",
				failures: [],
				routing: {
					capability: "coding.patch-cheap",
					authority: "takumi-fallback",
					enforcement: "capability-only",
					provider: "anthropic",
					model: "claude-3.5",
				},
				filesChanged: [],
			});

			const result = artifacts.find((a) => a.kind === "exec_result");
			expect(result).toBeDefined();
		});

		it("sets laneId from routing binding", () => {
			const artifacts = buildHubArtifacts({
				fullText: "result",
				failures: [],
				routing: {
					capability: "coding.patch-cheap",
					authority: "engine",
					enforcement: "same-provider",
					provider: "anthropic",
					model: "claude-3.5",
					laneId: "lane-xyz",
				},
				filesChanged: [],
			});

			for (const a of artifacts) {
				expect(a.laneId).toBe("lane-xyz");
			}
		});

		it("sets lower confidence when there are failures", () => {
			const artifacts = buildHubArtifacts({
				fullText: "partial",
				failures: ["error: timeout"],
				routing: {
					capability: "coding.patch-cheap",
					authority: "takumi-fallback",
					enforcement: "capability-only",
					provider: "anthropic",
					model: "claude-3.5",
				},
				filesChanged: [],
			});

			const response = artifacts.find((a) => a.kind === "assistant_response");
			expect(response!.confidence).toBe(0.5);
		});

		it("produces only exec_result for whitespace-only fullText", () => {
			const artifacts = buildHubArtifacts({
				fullText: "   \n\t  ",
				failures: [],
				routing: {
					capability: "coding.patch-cheap",
					authority: "takumi-fallback",
					enforcement: "capability-only",
					provider: "anthropic",
					model: "claude-3.5",
				},
				filesChanged: [],
			});

			expect(artifacts.find((a) => a.kind === "assistant_response")).toBeUndefined();
			expect(artifacts.find((a) => a.kind === "exec_result")).toBeDefined();
		});

		it("produces only exec_result for empty fullText", () => {
			const artifacts = buildHubArtifacts({
				fullText: "",
				failures: [],
				routing: {
					capability: "coding.patch-cheap",
					authority: "takumi-fallback",
					enforcement: "capability-only",
					provider: "anthropic",
					model: "claude-3.5",
				},
				filesChanged: [],
			});
			expect(artifacts.length).toBe(1);
			expect(artifacts[0].kind).toBe("exec_result");
		});
	});

	describe("persistExecArtifacts", () => {
		let homeDir: string;
		let previousHome: string | undefined;
		let artifactStore: ArtifactStore;

		beforeEach(async () => {
			homeDir = await mkdtemp(join(tmpdir(), "takumi-one-shot-artifacts-"));
			previousHome = process.env.HOME;
			process.env.HOME = homeDir;
			artifactStore = new ArtifactStore();
		});

		afterEach(async () => {
			process.env.HOME = previousHome;
			await rm(homeDir, { recursive: true, force: true });
		});

		it("persists completed one-shot artifacts locally when no canonical daemon session exists", async () => {
			const artifacts = buildHubArtifacts({
				fullText: "Hello from degraded mode",
				failures: [],
				routing: {
					capability: "coding.patch-cheap",
					authority: "takumi-fallback",
					enforcement: "capability-only",
					provider: "anthropic",
					model: "claude-3.5",
				},
				filesChanged: ["src/index.ts"],
			});

			await persistExecArtifacts(null, { projectPath: process.cwd() }, "run-local-1", artifacts);

			const stored = await artifactStore.query({ sessionId: "run-local-1" });
			expect(stored).toHaveLength(artifacts.length);
			for (const artifact of stored) {
				expect(artifact).toMatchObject({
					runId: "run-local-1",
					localSessionId: "run-local-1",
					importStatus: "pending",
					promoted: false,
				});
				expect(artifact.canonicalSessionId).toBeUndefined();
			}
		});

		it("imports persisted one-shot artifacts into Chitragupta when a canonical session exists", async () => {
			const artifacts = buildHubArtifacts({
				fullText: "One-shot canonical output",
				failures: [],
				routing: {
					capability: "coding.patch-cheap",
					authority: "engine",
					enforcement: "same-provider",
					provider: "anthropic",
					model: "claude-3.5",
					laneId: "lane-1",
				},
				filesChanged: [],
			});
			const bridge = {
				isConnected: true,
				artifactImportBatch: vi.fn<ExecArtifactBridge["artifactImportBatch"]>(async (_projectPath, _consumer, inputs) => ({
					contractVersion: 1,
					consumer: "takumi",
					projectPath: process.cwd(),
					imported: inputs.map((input, index) => ({
						localArtifactId: input.localArtifactId,
						canonicalArtifactId: `cart-${index + 1}`,
						contentHash: input.contentHash,
						promoted: true as const,
					})),
					skipped: [],
					failed: [],
				})),
				artifactListImported: vi.fn<ExecArtifactBridge["artifactListImported"]>(async (_projectPath, _consumer, canonicalSessionId) => ({
					contractVersion: 1,
					projectPath: process.cwd(),
					items: artifacts.map((artifact, index) => ({
						localArtifactId: artifact.artifactId,
						canonicalArtifactId: `cart-${index + 1}`,
						contentHash: artifact.contentHash,
						promoted: true as const,
						consumer: "takumi",
						projectPath: process.cwd(),
						canonicalSessionId: canonicalSessionId ?? null,
						localSessionId: "run-canon-1",
						runId: "run-canon-1",
						kind: artifact.kind,
						producer: artifact.producer,
						summary: artifact.summary,
						body: artifact.body ?? null,
						path: artifact.path ?? null,
						confidence: artifact.confidence ?? null,
						createdAt: artifact.createdAt,
						taskId: "run-canon-1",
						laneId: artifact.laneId ?? null,
						metadata: artifact.metadata ?? {},
						importedAt: 1111,
					})),
				})),
			} satisfies ExecArtifactBridge;

			await persistExecArtifacts(
				bridge,
				{ projectPath: process.cwd(), canonicalSessionId: "canon-1" },
				"run-canon-1",
				artifacts,
			);

			expect(bridge.artifactImportBatch).toHaveBeenCalledWith(
				process.cwd(),
				"takumi",
				expect.arrayContaining([
					expect.objectContaining({
						localSessionId: "run-canon-1",
						canonicalSessionId: "canon-1",
						runId: "run-canon-1",
					}),
				]),
				"canon-1",
			);

			const stored = await artifactStore.query({ sessionId: "canon-1" });
			expect(stored).toHaveLength(artifacts.length);
			for (const artifact of stored) {
				expect(artifact).toMatchObject({
					runId: "run-canon-1",
					localSessionId: "run-canon-1",
					canonicalSessionId: "canon-1",
					importStatus: "imported",
					promoted: true,
				});
				expect(artifact.canonicalArtifactId).toMatch(/^cart-/);
			}
		});
	});

	describe("determineExecCapability — word boundaries", () => {
		it("does NOT match 'preview' as review", () => {
			expect(determineExecCapability("preview the changes")).toBe("coding.patch-cheap");
		});

		it("does NOT match 'deeper' as deep", () => {
			expect(determineExecCapability("fix deeper issues")).toBe("coding.patch-cheap");
		});

		it("matches 'review' as standalone word", () => {
			expect(determineExecCapability("review changes")).toBe("coding.review.strict");
		});

		it("matches 'deep' at prompt length ≤ 800", () => {
			expect(determineExecCapability("deep analysis needed")).toBe("coding.deep-reasoning");
		});

		it("triggers deep-reasoning at exactly 801 chars", () => {
			expect(determineExecCapability("x".repeat(801))).toBe("coding.deep-reasoning");
		});

		it("returns patch-cheap at exactly 800 chars", () => {
			expect(determineExecCapability("x".repeat(800))).toBe("coding.patch-cheap");
		});
	});
});
