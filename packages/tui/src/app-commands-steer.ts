/**
 * Steering commands — Phase 48.
 * Allows users to inject priority directives into the agent mid-run.
 */

import { SteeringPriority } from "@takumi/agent";
import type { AppCommandContext } from "./app-command-context.js";

/**
 * Register steering-related slash commands.
 *
 * - `/steer <text>` — enqueue a NORMAL-priority directive
 * - `/interrupt <text>` — enqueue an INTERRUPT-priority directive (highest)
 * - `/steerq` — show current steering queue state
 */
export function registerSteeringCommands(ctx: AppCommandContext): void {
	const { commands, state, addInfoMessage } = ctx;

	// ── /steer — inject a normal-priority directive ───────────────────────────
	commands.register(
		"/steer",
		"Inject a directive into the agent's next turn",
		(args: string) => {
			const text = args.trim();
			if (!text) {
				addInfoMessage("Usage: /steer <directive text>");
				return;
			}
			const id = state.steeringQueue.enqueue(text, { priority: SteeringPriority.NORMAL });
			if (id) {
				state.steeringPending.value = state.steeringQueue.size;
				addInfoMessage(`⏩ Steering directive queued (${state.steeringQueue.size} pending)`);
			} else {
				addInfoMessage("⚠️ Steering queue is full — directive not enqueued.");
			}
		},
		["/st"],
	);

	// ── /interrupt — inject a highest-priority directive ──────────────────────
	commands.register(
		"/interrupt",
		"Inject an urgent interrupt directive",
		(args: string) => {
			const text = args.trim();
			if (!text) {
				addInfoMessage("Usage: /interrupt <directive text>");
				return;
			}
			const id = state.steeringQueue.enqueue(text, { priority: SteeringPriority.INTERRUPT });
			if (id) {
				state.steeringPending.value = state.steeringQueue.size;
				addInfoMessage(`🚨 Interrupt directive queued — will override current direction`);
			} else {
				addInfoMessage("⚠️ Steering queue is full — directive not enqueued.");
			}
		},
		["/int"],
	);

	// ── /steerq — show steering queue status ─────────────────────────────────
	commands.register(
		"/steerq",
		"Show pending steering queue items",
		() => {
			const snapshot = state.steeringQueue.snapshot();
			if (snapshot.length === 0) {
				addInfoMessage("Steering queue is empty.");
				return;
			}
			const priorityLabels = ["INTERRUPT", "HIGH", "NORMAL", "LOW"];
			const lines = snapshot.map((item, i) => {
				const label = priorityLabels[item.priority] ?? `P${item.priority}`;
				const preview = item.text.length > 60 ? `${item.text.slice(0, 57)}...` : item.text;
				return `  ${i + 1}. [${label}] ${preview}`;
			});
			addInfoMessage(`Steering queue (${snapshot.length} items):\n${lines.join("\n")}`);
		},
		["/sq"],
	);
}
