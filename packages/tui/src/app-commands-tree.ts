/**
 * Session Tree Commands — Phase 47
 *
 * Slash commands for session branching and tree navigation:
 * - /branch [label]   — Branch at current turn
 * - /session-tree     — Show session tree
 * - /switch <id>      — Switch to a different session
 * - /siblings         — Show branches at the same level
 * - /parent           — Navigate to parent session
 */

import type { FlatTreeEntry, SessionTreeManifest, SessionTreeNode } from "@takumi/core";
import {
	branchSession,
	flattenTree,
	getAncestors,
	getSessionTree,
	getSiblings,
	loadSession,
	loadTreeManifest,
	registerInTree,
	saveSession,
} from "@takumi/core";
import type { AppCommandContext } from "./app-command-context.js";

// ── Tree Renderer ────────────────────────────────────────────────────────────

/**
 * Render a flat tree to a Unicode string for display in the TUI.
 * Highlights the current session with a marker.
 */
export function renderTree(entries: FlatTreeEntry[], currentSessionId?: string): string {
	if (entries.length === 0) return "(No sessions in tree)";

	const lines: string[] = [];
	for (const entry of entries) {
		const marker = entry.id === currentSessionId ? " ◀" : "";
		const truncId = entry.id.length > 24 ? `${entry.id.slice(0, 21)}...` : entry.id;
		lines.push(`${entry.prefix}${entry.label} \x1b[2m(${truncId})\x1b[0m${marker}`);
	}
	return lines.join("\n");
}

/**
 * Render a compact sibling list.
 */
function renderSiblings(siblings: SessionTreeNode[], currentId: string): string {
	if (siblings.length === 0) return "No sibling branches.";
	const lines = siblings.map((s) => {
		const marker = s.id === currentId ? " ◀ (current)" : "";
		return `  • ${s.label} \x1b[2m(${s.id})\x1b[0m${marker}`;
	});
	return `Sibling branches:\n${lines.join("\n")}`;
}

/**
 * Render a breadcrumb path from root to current session.
 */
function renderBreadcrumb(manifest: SessionTreeManifest, sessionId: string): string {
	const ancestors = getAncestors(manifest, sessionId);
	const current = manifest.nodes[sessionId];
	if (!current) return sessionId;
	const path = [...ancestors.reverse(), current];
	return path.map((n) => n.label).join(" → ");
}

// ── Command Registration ─────────────────────────────────────────────────────

export function registerSessionTreeCommands(ctx: AppCommandContext): void {
	// /branch [label] — create a branch at the current message index
	ctx.commands.register(
		"/branch",
		"Branch conversation at current point",
		async (args) => {
			const sessionId = ctx.state.sessionId.value;
			if (!sessionId) {
				ctx.addInfoMessage("No active session to branch from.");
				return;
			}

			// Ensure current session is saved and in tree
			const sessionData = ctx.buildSessionData();
			await saveSession(sessionData);
			await registerInTree(sessionId, sessionData.title || sessionId);

			const branchPoint = ctx.state.messages.value.length;
			const label = args.trim() || undefined;
			const result = await branchSession(sessionId, branchPoint, label);

			if (!result) {
				ctx.addInfoMessage("Failed to create branch.");
				return;
			}

			ctx.addInfoMessage(
				`🌿 Branched at message ${result.branchPoint} → ${result.newSessionId}\n` +
					`Label: ${label ?? `Branch @${result.branchPoint}`}\n` +
					`Use /switch ${result.newSessionId} to switch to it.`,
			);
		},
		["/br"],
	);

	// /session-tree — display the full session tree
	ctx.commands.register(
		"/session-tree",
		"Show session tree",
		async () => {
			const sessionId = ctx.state.sessionId.value;

			// Ensure current session is in the tree
			if (sessionId) {
				const sessionData = ctx.buildSessionData();
				await registerInTree(sessionId, sessionData.title || sessionId);
			}

			const manifest = await getSessionTree();
			const entries = flattenTree(manifest);
			const tree = renderTree(entries, sessionId);
			const breadcrumb = sessionId ? renderBreadcrumb(manifest, sessionId) : "";
			const header = breadcrumb ? `📍 ${breadcrumb}\n\n` : "";
			ctx.addInfoMessage(`${header}Session Tree:\n${tree}`);
		},
		["/branches", "/tree"],
	);

	// /switch <id> — switch to a different session
	ctx.commands.register(
		"/switch",
		"Switch to a session by ID",
		async (args) => {
			const targetId = args.trim();
			if (!targetId) {
				ctx.addInfoMessage("Usage: /switch <session-id>\nUse /tree to see available sessions.");
				return;
			}

			const session = await loadSession(targetId);
			if (!session) {
				ctx.addInfoMessage(`Session not found: ${targetId}`);
				return;
			}

			// Save current session first
			const currentData = ctx.buildSessionData();
			if (currentData.id) {
				await saveSession(currentData);
			}

			// Load the target session
			ctx.state.messages.value = session.messages;
			ctx.state.sessionId.value = session.id;
			ctx.state.model.value = session.model;
			ctx.state.totalInputTokens.value = session.tokenUsage.inputTokens;
			ctx.state.totalOutputTokens.value = session.tokenUsage.outputTokens;
			ctx.state.totalCost.value = session.tokenUsage.totalCost;
			ctx.state.turnCount.value = session.messages.filter((m) => m.role === "user").length;
			ctx.agentRunner?.clearHistory();

			ctx.addInfoMessage(
				`Switched to session: ${session.title || session.id}\n` +
					`Messages: ${session.messages.length}, Model: ${session.model}`,
			);
		},
		["/sw"],
	);

	// /siblings — show branches at the same level
	ctx.commands.register(
		"/siblings",
		"Show sibling branches",
		async () => {
			const sessionId = ctx.state.sessionId.value;
			if (!sessionId) {
				ctx.addInfoMessage("No active session.");
				return;
			}

			const manifest = await loadTreeManifest();
			if (!manifest.nodes[sessionId]) {
				ctx.addInfoMessage("Current session is not in the tree yet. Use /branch first.");
				return;
			}

			const siblings = getSiblings(manifest, sessionId);
			ctx.addInfoMessage(renderSiblings(siblings, sessionId));
		},
		["/sib"],
	);

	// /parent — navigate to parent session
	ctx.commands.register(
		"/parent",
		"Switch to parent session",
		async () => {
			const sessionId = ctx.state.sessionId.value;
			if (!sessionId) {
				ctx.addInfoMessage("No active session.");
				return;
			}

			const manifest = await loadTreeManifest();
			const node = manifest.nodes[sessionId];
			if (!node || !node.parentId) {
				ctx.addInfoMessage("Current session has no parent (it's a root).");
				return;
			}

			// Delegate to /switch logic
			const parent = await loadSession(node.parentId);
			if (!parent) {
				ctx.addInfoMessage(`Parent session not found: ${node.parentId}`);
				return;
			}

			// Save current, load parent
			const currentData = ctx.buildSessionData();
			if (currentData.id) await saveSession(currentData);

			ctx.state.messages.value = parent.messages;
			ctx.state.sessionId.value = parent.id;
			ctx.state.model.value = parent.model;
			ctx.state.totalInputTokens.value = parent.tokenUsage.inputTokens;
			ctx.state.totalOutputTokens.value = parent.tokenUsage.outputTokens;
			ctx.state.totalCost.value = parent.tokenUsage.totalCost;
			ctx.state.turnCount.value = parent.messages.filter((m) => m.role === "user").length;
			ctx.agentRunner?.clearHistory();

			ctx.addInfoMessage(`Navigated to parent: ${parent.title || parent.id}`);
		},
		["/up"],
	);
}
