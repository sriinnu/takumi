import type { TakumiConfig } from "@takumi/core";
import { createProvider } from "./provider.js";

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

export async function readStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(chunk);
	return Buffer.concat(chunks).toString("utf-8").trim();
}

export async function runOneShot(config: TakumiConfig, prompt: string, fallbackName?: string): Promise<void> {
	const { ToolRegistry, registerBuiltinTools, agentLoop, buildContext } = await import("@takumi/agent");
	const provider = await createProvider(config, fallbackName);

	const tools = new ToolRegistry();
	registerBuiltinTools(tools);

	const system = await buildContext({
		cwd: process.cwd(),
		tools: tools.getDefinitions(),
		customPrompt: config.systemPrompt || undefined,
	});

	const loop = agentLoop(prompt, [], {
		sendMessage: (messages: any, sys: any, toolDefs: any, signal: any, options: any) =>
			provider.sendMessage(messages, sys, toolDefs, signal, options),
		tools,
		systemPrompt: system,
		maxTurns: config.maxTurns,
	});

	for await (const event of loop) {
		switch (event.type) {
			case "text_delta":
				process.stdout.write(event.text);
				break;
			case "tool_use":
				process.stderr.write(`\n[${event.name}] `);
				break;
			case "tool_result":
				if (event.isError) process.stderr.write(`error: ${event.output.slice(0, 200)}\n`);
				else process.stderr.write("done\n");
				break;
			case "error":
				process.stderr.write(`\nError: ${event.error.message}\n`);
				break;
		}
	}
	process.stdout.write("\n");
}
