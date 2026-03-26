import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export interface CliCandidate {
	id: "claude" | "codex" | "gemini";
	command: string;
	argsForPrompt: (prompt: string) => string[];
	timeoutMs: number;
}

export interface CliAuditOutput {
	text: string;
	toolUses: string[];
	inputTokens: number;
	outputTokens: number;
	costUsd: number;
}

function commandExists(command: string): boolean {
	const probe = spawnSync("sh", ["-lc", `command -v ${command}`], {
		encoding: "utf-8",
		stdio: ["ignore", "ignore", "ignore"],
	});
	return probe.status === 0;
}

export function buildCliCandidates(): CliCandidate[] {
	const candidates: CliCandidate[] = [];
	if (commandExists("codex")) {
		candidates.push({
			id: "codex",
			command: "codex",
			argsForPrompt: (prompt) => ["exec", "--skip-git-repo-check", "--sandbox", "read-only", prompt],
			timeoutMs: 120_000,
		});
	}
	if (commandExists("claude")) {
		candidates.push({
			id: "claude",
			command: "claude",
			argsForPrompt: (prompt) => ["-p", prompt],
			timeoutMs: 120_000,
		});
	}
	if (commandExists("gemini")) {
		candidates.push({
			id: "gemini",
			command: "gemini",
			argsForPrompt: (prompt) => ["--prompt", prompt],
			timeoutMs: 120_000,
		});
	}
	return candidates;
}

function parseCliOutput(candidate: CliCandidate, stdout: string): string {
	if (candidate.id !== "codex") return stdout.trim();
	const lines = stdout.split("\n");
	const assistantIndex = lines.map((line) => line.trim()).lastIndexOf("assistant");
	if (assistantIndex >= 0 && assistantIndex + 1 < lines.length) {
		const tail = lines.slice(assistantIndex + 1).join("\n");
		const stripped = tail.replace(/\n?tokens used[\s\S]*$/m, "").trim();
		if (stripped) return stripped;
	}
	const markerIndex = lines.findIndex((line) => line.trim() === "codex");
	if (markerIndex >= 0 && markerIndex + 1 < lines.length) {
		const tail = lines.slice(markerIndex + 1).join("\n");
		const stripped = tail.replace(/\n?tokens used[\s\S]*$/m, "").trim();
		if (stripped) return stripped;
	}
	if (stdout.includes("OpenAI Codex")) {
		return "";
	}
	return stdout.trim();
}

export function runCliAudit(params: { cwd: string; prompt: string; candidate: CliCandidate }): CliAuditOutput {
	if (params.candidate.id === "codex") {
		const tempDir = mkdtempSync(join(tmpdir(), "takumi-autosearch-codex-"));
		const outputFile = join(tempDir, "last-message.txt");
		try {
			const promptArgs = params.candidate.argsForPrompt(params.prompt);
			const prompt = promptArgs[promptArgs.length - 1] ?? params.prompt;
			const baseArgs = promptArgs.slice(0, -1);
			const result = spawnSync(
				params.candidate.command,
				[...baseArgs, "--output-last-message", outputFile, prompt],
				{
					cwd: params.cwd,
					encoding: "utf-8",
					timeout: params.candidate.timeoutMs,
					maxBuffer: 1024 * 1024 * 8,
				},
			);
			if (result.status !== 0) {
				throw new Error((result.stderr || result.stdout || `${params.candidate.command} failed`).trim());
			}
			const fileText = existsSync(outputFile) ? readFileSync(outputFile, "utf-8").trim() : "";
			const stdoutText = parseCliOutput(params.candidate, result.stdout || "");
			const stderrText = parseCliOutput(params.candidate, result.stderr || "");
			const text = (fileText || stdoutText || stderrText).trim();
			if (!text) {
				const rawStderrText = (result.stderr || "").trim();
				throw new Error(
					[
						"codex produced no output",
						`fileExists=${existsSync(outputFile)}`,
						stdoutText ? `stdout=${JSON.stringify(stdoutText.slice(0, 400))}` : "stdout=<empty>",
						stderrText ? `stderr=${JSON.stringify(stderrText.slice(0, 400))}` : "stderr=<empty>",
						rawStderrText ? `rawStderr=${JSON.stringify(rawStderrText.slice(0, 400))}` : "rawStderr=<empty>",
					].join("; "),
				);
			}
			return { text, toolUses: [params.candidate.id], inputTokens: 0, outputTokens: 0, costUsd: 0 };
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	}

	const result = spawnSync(params.candidate.command, params.candidate.argsForPrompt(params.prompt), {
		cwd: params.cwd,
		encoding: "utf-8",
		timeout: params.candidate.timeoutMs,
		maxBuffer: 1024 * 1024 * 8,
	});
	if (result.status !== 0) {
		throw new Error((result.stderr || result.stdout || `${params.candidate.command} failed`).trim());
	}
	const text = parseCliOutput(params.candidate, result.stdout || "");
	if (!text) {
		throw new Error(`${params.candidate.command} produced no output`);
	}
	return { text, toolUses: [params.candidate.id], inputTokens: 0, outputTokens: 0, costUsd: 0 };
}

export function filterHealthyCliCandidates(cwd: string, candidates: CliCandidate[]): CliCandidate[] {
	const healthy: CliCandidate[] = [];
	for (const candidate of candidates) {
		try {
			const result = runCliAudit({ cwd, prompt: "Reply with exactly: OK", candidate });
			if (result.text.trim() === "OK") {
				healthy.push(candidate);
			}
		} catch {
			// Skip unhealthy CLI candidates.
		}
	}
	return healthy;
}
