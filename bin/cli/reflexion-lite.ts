import { homedir } from "node:os";
import { join } from "node:path";

interface ReflexionRecord {
	timestamp: number;
	prompt: string;
	findings: string[];
}

function getReflexionFilePath(): string {
	return join(homedir(), ".takumi", "memory", "oneshot-reflexion.jsonl");
}

export async function loadRecentReflexions(limit = 5): Promise<ReflexionRecord[]> {
	const fs = await import("node:fs/promises");
	const path = await import("node:path");
	const filePath = getReflexionFilePath();

	try {
		const text = await fs.readFile(filePath, "utf-8");
		const lines = text.split("\n").filter(Boolean);
		const parsed: ReflexionRecord[] = [];
		for (const line of lines) {
			try {
				const value = JSON.parse(line) as ReflexionRecord;
				if (
					typeof value?.timestamp === "number" &&
					typeof value?.prompt === "string" &&
					Array.isArray(value?.findings)
				) {
					parsed.push(value);
				}
			} catch {
				// ignore malformed rows
			}
		}
		return parsed.sort((a, b) => b.timestamp - a.timestamp).slice(0, Math.max(1, limit));
	} catch {
		await fs.mkdir(path.dirname(filePath), { recursive: true }).catch(() => undefined);
		return [];
	}
}

export function buildReflexionPrompt(records: ReflexionRecord[]): string {
	if (records.length === 0) return "";

	const sections = records.map((r, idx) => {
		const findings = r.findings.slice(0, 4).map((f) => `- ${f}`).join("\n");
		return [
			`Case ${idx + 1} (${new Date(r.timestamp).toISOString()}):`,
			`Task snippet: ${r.prompt.slice(0, 180).replace(/\s+/g, " ")}`,
			"Findings:",
			findings,
		].join("\n");
	});

	return [
		"Reflexion Memory (recent failures):",
		"Use these to avoid repeating prior mistakes. Prioritize deterministic, testable fixes.",
		...sections,
	].join("\n\n");
}

export async function saveReflexion(prompt: string, findings: string[]): Promise<void> {
	const fs = await import("node:fs/promises");
	const path = await import("node:path");
	const filePath = getReflexionFilePath();
	const record: ReflexionRecord = {
		timestamp: Date.now(),
		prompt: prompt.slice(0, 1200),
		findings: findings
			.map((f) => f.trim())
			.filter(Boolean)
			.slice(0, 12),
	};

	if (record.findings.length === 0) return;

	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, "utf-8");
}
