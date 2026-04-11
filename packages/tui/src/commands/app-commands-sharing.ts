/**
 * @file app-commands-sharing.ts
 * @module app-commands-sharing
 *
 * /share command — export the current conversation as a markdown file or
 * copy it to the clipboard. Future: GitHub Gist upload when a token is available.
 */

import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AppCommandContext } from "./app-command-context.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function blockToText(block: { type: string; text?: string; thinking?: string; name?: string }): string {
	if (block.type === "text" && block.text) return block.text;
	if (block.type === "thinking" && block.thinking)
		return `<details><summary>Thinking</summary>\n\n${block.thinking}\n\n</details>`;
	if (block.type === "tool_use" && block.name) return `_Tool: ${block.name}_`;
	return "";
}

function conversationToMarkdown(ctx: AppCommandContext): string {
	const msgs = ctx.state.messages.value;
	const lines: string[] = [
		`# Takumi conversation — ${new Date().toISOString().slice(0, 10)}`,
		"",
		`Model: ${ctx.state.model.value}  ·  Provider: ${ctx.state.provider.value}`,
		"",
		"---",
		"",
	];
	for (const msg of msgs) {
		const role = msg.role === "assistant" ? "**Assistant**" : msg.role === "user" ? "**User**" : `**${msg.role}**`;
		lines.push(`### ${role}`);
		const content = msg.content;
		if (typeof content === "string") {
			lines.push(content);
		} else if (Array.isArray(content)) {
			for (const block of content) {
				const txt = blockToText(block as { type: string; text?: string; thinking?: string; name?: string });
				if (txt) lines.push(txt);
			}
		}
		lines.push("");
	}
	return lines.join("\n");
}

async function uploadConversationGist(ctx: AppCommandContext, fileName?: string): Promise<string> {
	const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
	if (!token) {
		throw new Error("Set GITHUB_TOKEN or GH_TOKEN to use gist sharing");
	}

	const markdown = conversationToMarkdown(ctx);
	const response = await fetch("https://api.github.com/gists", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/vnd.github+json",
			authorization: `Bearer ${token}`,
			"user-agent": "takumi-share",
		},
		body: JSON.stringify({
			description: `Takumi conversation (${ctx.state.provider.value}/${ctx.state.model.value})`,
			public: false,
			files: {
				[fileName || `takumi-share-${Date.now()}.md`]: {
					content: markdown,
				},
			},
		}),
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`GitHub gist upload failed (${response.status}): ${body.slice(0, 200)}`);
	}

	const payload = (await response.json()) as { html_url?: string };
	if (!payload.html_url) {
		throw new Error("GitHub gist upload succeeded but no URL was returned");
	}

	return payload.html_url;
}

// ─── Registration ────────────────────────────────────────────────────────────

export function registerSharingCommands(ctx: AppCommandContext): void {
	ctx.commands.register("/share", "Export conversation (file, clipboard, gist)", async (args) => {
		const trimmed = args.trim();
		const [sub, ...rest] = trimmed.split(/\s+/).filter(Boolean);
		const mode = sub || "file";

		if (mode === "file") {
			const md = conversationToMarkdown(ctx);
			const ts = Date.now();
			const outPath = join(ctx.config.workingDirectory || process.cwd(), `takumi-share-${ts}.md`);
			await writeFile(outPath, md, "utf-8");
			return ctx.addInfoMessage(`Conversation exported to ${outPath}`);
		}

		if (mode === "clipboard") {
			const md = conversationToMarkdown(ctx);
			try {
				const { execSync } = await import("node:child_process");
				const platform = process.platform;
				if (platform === "darwin") {
					execSync("pbcopy", { input: md, encoding: "utf-8" });
				} else if (platform === "linux") {
					execSync("xclip -selection clipboard", { input: md, encoding: "utf-8" });
				} else {
					return ctx.addInfoMessage("Clipboard not supported on this platform — use /share file");
				}
				return ctx.addInfoMessage("Conversation copied to clipboard");
			} catch {
				return ctx.addInfoMessage("Failed to copy — is xclip/pbcopy installed?");
			}
		}

		if (mode === "gist") {
			try {
				const fileName = rest[0];
				const url = await uploadConversationGist(ctx, fileName);
				return ctx.addInfoMessage(`Conversation uploaded as private gist:\n${url}`);
			} catch (err) {
				return ctx.addInfoMessage(`Failed to share as gist: ${(err as Error).message}`);
			}
		}

		ctx.addInfoMessage("Usage: /share file | /share clipboard | /share gist [filename]");
	});

	ctx.commands.register("/editor", "Open $EDITOR to compose a message", async () => {
		const editor = process.env.EDITOR || process.env.VISUAL;
		if (!editor) {
			return ctx.addInfoMessage("Set $EDITOR or $VISUAL to use this command");
		}
		const tmpFile = resolve(tmpdir(), `takumi-edit-${Date.now()}.md`);
		await writeFile(tmpFile, "", "utf-8");
		try {
			const { spawnSync } = await import("node:child_process");
			spawnSync(editor, [tmpFile], { stdio: "inherit" });
			const content = (await readFile(tmpFile, "utf-8")).trim();
			if (!content) return ctx.addInfoMessage("Editor closed with no content");
			// Queue as next user turn via the agent runner
			if (ctx.agentRunner) {
				void ctx.agentRunner.submit(content);
			} else {
				ctx.addInfoMessage(`No agent runner — content saved to ${tmpFile}`);
			}
		} catch (err) {
			ctx.addInfoMessage(`Failed to open editor: ${(err as Error).message}`);
		}
	});
}
