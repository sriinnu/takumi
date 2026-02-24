function formatAge(ts: number): string {
	const diff = Date.now() - ts;
	const mins = Math.floor(diff / 60_000);
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h ago`;
	return `${Math.floor(hrs / 24)}d ago`;
}

export async function cmdList(): Promise<void> {
	const { listSessions } = await import("@takumi/core");
	const sessions = await listSessions(50);
	if (sessions.length === 0) {
		console.log("No sessions found.");
		return;
	}
	console.log(`\nSessions (${sessions.length}):\n`);
	for (const s of sessions) {
		const date = new Date(s.updatedAt).toLocaleString();
		console.log(`  \x1b[1;36m${s.id}\x1b[0m`);
		console.log(`    Title:    ${s.title || "(untitled)"}`);
		console.log(`    Model:    ${s.model}`);
		console.log(`    Messages: ${s.messageCount}`);
		console.log(`    Updated:  ${date} (${formatAge(s.updatedAt)})`);
		console.log();
	}
}

export async function cmdStatus(id: string): Promise<void> {
	const { loadSession } = await import("@takumi/core");
	const session = await loadSession(id);
	if (!session) {
		console.error(`Session not found: ${id}`);
		process.exit(1);
	}
	console.log(`\n\x1b[1mSession:\x1b[0m ${session.id}`);
	console.log(`  Title:         ${session.title || "(untitled)"}`);
	console.log(`  Model:         ${session.model}`);
	console.log(`  Created:       ${new Date(session.createdAt).toLocaleString()}`);
	console.log(`  Updated:       ${new Date(session.updatedAt).toLocaleString()}`);
	console.log(`  Messages:      ${session.messages.length}`);
	console.log(`  Input tokens:  ${session.tokenUsage.inputTokens.toLocaleString()}`);
	console.log(`  Output tokens: ${session.tokenUsage.outputTokens.toLocaleString()}`);
	console.log(`  Est. cost:     $${session.tokenUsage.totalCost.toFixed(4)}`);
	console.log();
}

export async function cmdLogs(id: string): Promise<void> {
	const { loadSession } = await import("@takumi/core");
	const session = await loadSession(id);
	if (!session) {
		console.error(`Session not found: ${id}`);
		process.exit(1);
	}
	console.log(`\n── Session: \x1b[1m${session.id}\x1b[0m ──\n`);
	for (const msg of session.messages) {
		const roleLabel =
			msg.role === "user"
				? "\x1b[1;34m[user]\x1b[0m"
				: msg.role === "assistant"
					? "\x1b[1;32m[assistant]\x1b[0m"
					: `\x1b[1;33m[${msg.role}]\x1b[0m`;
		console.log(roleLabel);
		const content = msg.content as any;
		if (Array.isArray(content)) {
			for (const block of content) {
				if (block.type === "text") console.log(block.text);
				else if (block.type === "tool_use") console.log(`  \x1b[2m[tool: ${block.name}]\x1b[0m`);
				else if (block.type === "tool_result") {
					const raw = Array.isArray(block.content) ? (block.content[0]?.text ?? "") : String(block.content ?? "");
					console.log(`  \x1b[2m[result: ${raw.slice(0, 200)}]\x1b[0m`);
				}
			}
		} else {
			console.log(content);
		}
		console.log();
	}
}

export async function cmdExport(id: string): Promise<void> {
	const { loadSession } = await import("@takumi/core");
	const session = await loadSession(id);
	if (!session) {
		console.error(`Session not found: ${id}`);
		process.exit(1);
	}
	const lines: string[] = [
		`# ${session.title || "Takumi Session"}`,
		"",
		`**ID:** \`${session.id}\`  `,
		`**Model:** \`${session.model}\`  `,
		`**Created:** ${new Date(session.createdAt).toISOString()}  `,
		`**Updated:** ${new Date(session.updatedAt).toISOString()}  `,
		`**Messages:** ${session.messages.length}  `,
		"",
		"---",
		"",
	];
	for (const msg of session.messages) {
		const role = msg.role.charAt(0).toUpperCase() + msg.role.slice(1);
		lines.push(`## ${role}`);
		lines.push("");
		const content = msg.content as any;
		if (Array.isArray(content)) {
			for (const block of content) {
				if (block.type === "text") lines.push(block.text);
				else if (block.type === "tool_use") {
					lines.push("```tool:" + block.name);
					lines.push(JSON.stringify(block.input, null, 2));
					lines.push("```");
				} else if (block.type === "tool_result") {
					const raw = Array.isArray(block.content) ? (block.content[0]?.text ?? "") : String(block.content ?? "");
					lines.push("```result");
					lines.push(raw);
					lines.push("```");
				}
			}
		} else lines.push(String(content ?? ""));
		lines.push("");
	}
	process.stdout.write(lines.join("\n"));
	process.stdout.write("\n");
}

export async function cmdDelete(id: string): Promise<void> {
	const { deleteSession } = await import("@takumi/core");
	await deleteSession(id);
	console.log(`Deleted session: ${id}`);
}
