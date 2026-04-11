import type { ExecArtifact } from "./exec-protocol.js";

/** Fetch GitHub issue context opportunistically for one-shot prompts. */
export async function fetchIssueContext(issueRef: string): Promise<string> {
	const { spawn } = await import("node:child_process");
	return new Promise((resolve) => {
		const ref = issueRef.replace(/^#/, "");
		const child = spawn("gh", ["issue", "view", ref, "--json", "title,body,url"], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		let out = "";
		child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
		child.on("close", (code: number) => {
			if (code !== 0) {
				process.stderr.write(`[warning] Could not fetch issue "${issueRef}" — continuing without it.\n`);
				resolve("");
				return;
			}
			try {
				const { title, body, url } = JSON.parse(out);
				resolve(`GitHub Issue: ${title}\nURL: ${url}\n\n${body}\n\n---\n\n`);
			} catch {
				resolve("");
			}
		});
	});
}

/** Read a piped prompt from stdin when exec/headless is used non-interactively. */
export async function readStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(chunk);
	return Buffer.concat(chunks).toString("utf-8").trim();
}

/** Build portable artifact summaries for exec protocol consumers. */
export function buildExecArtifacts(fullText: string, failures: string[]): ExecArtifact[] {
	const artifacts: ExecArtifact[] = [];
	if (fullText.trim()) {
		artifacts.push({
			type: "assistant_response",
			summary: fullText.trim().slice(0, 240),
		});
	}
	if (failures.length > 0) {
		artifacts.push({
			type: "postmortem",
			summary: failures.join(" | ").slice(0, 240),
		});
	}
	artifacts.push({
		type: "exec-result",
		summary: fullText.trim() ? "One-shot execution completed" : "One-shot execution completed without assistant text",
	});
	return artifacts;
}
