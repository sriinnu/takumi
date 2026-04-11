/**
 * app-commands-yagna.ts — Slash commands for the Yagna autonomous ritual system.
 *
 * Registers three commands:
 *   /yagna (aliases: /autopilot, /ap) — Full DECOMPOSE → TARKA → KRIYA → VERIFY → MERGE pipeline.
 *   /tarka (aliases: /duh, /argue)    — Full pipeline; emphasises the debate phase (extra rounds).
 *   /kriya (aliases: /tf, /blitz)     — Full pipeline; skips Tarka (maxTarkaRounds=0) for speed.
 *
 * Flags parsed from the raw args string:
 *   --rounds=N    Override Tarka round count.
 *   --retries=N   Override Kriya retry budget.
 *   --timeout=N   Global timeout in minutes (converted to ms internally).
 *   --no-merge    Skip the final branch merge phase.
 */

import { createYagnaSnapshot, runYagnaLoop } from "../yagna/yagna-loop.js";
import type { YagnaConfig, YagnaEvent } from "../yagna/yagna-types.js";
import type { AppCommandContext } from "./app-command-context.js";

/**
 * Register all Yagna-related slash commands on the command registry.
 *
 * @param ctx - TUI app command context for command registration.
 */
export function registerYagnaCommands(ctx: AppCommandContext): void {
	/* ── /yagna — the full autonomous ritual ─────────────── */
	ctx.commands.register(
		"/yagna",
		"Autonomous multi-agent ritual: decompose → debate → execute → verify → merge",
		async (args) => {
			const { topic, overrides } = parseYagnaArgs(args);
			if (!topic) {
				ctx.addInfoMessage(USAGE_YAGNA);
				return;
			}
			await launchYagna(ctx, topic, overrides);
		},
		["/autopilot", "/ap"],
	);

	/* ── /tarka — debate-heavy variant ───────────────────── */
	ctx.commands.register(
		"/tarka",
		"Yagna with emphasis on Tarka (debate). Default: 5 rounds.",
		async (args) => {
			const { topic, overrides } = parseYagnaArgs(args);
			if (!topic) {
				ctx.addInfoMessage(USAGE_TARKA);
				return;
			}
			// Default to 5 rounds when not explicitly overridden.
			if (overrides.maxTarkaRounds === undefined) {
				overrides.maxTarkaRounds = 5;
			}
			await launchYagna(ctx, topic, overrides);
		},
		["/duh", "/argue"],
	);

	/* ── /kriya — execution-only blitz (skip Tarka) ──────── */
	ctx.commands.register(
		"/kriya",
		"Yagna blitz mode: skip debate, straight to execution.",
		async (args) => {
			const { topic, overrides } = parseYagnaArgs(args);
			if (!topic) {
				ctx.addInfoMessage(USAGE_KRIYA);
				return;
			}
			// Zero Tarka rounds → the loop skips debate entirely.
			overrides.maxTarkaRounds = 0;
			await launchYagna(ctx, topic, overrides);
		},
		["/tf", "/blitz"],
	);
}

/* ── Launch helper ───────────────────────────────────────────── */

/**
 * Create a snapshot, wire up event logging, and run the Yagna loop.
 *
 * @param ctx - TUI app context.
 * @param topic - The user's high-level objective.
 * @param overrides - Config overrides from parsed flags.
 */
async function launchYagna(ctx: AppCommandContext, topic: string, overrides: Partial<YagnaConfig>): Promise<void> {
	const snap = createYagnaSnapshot(topic, overrides);

	// Collect events for a final summary; also log phase transitions.
	const _events: YagnaEvent[] = [];
	const emit = (event: YagnaEvent): void => {
		_events.push(event);
	};

	ctx.addInfoMessage(`\ud83d\udd25 Yagna "${topic}" initiated (id: ${snap.id}).`);
	const result = await runYagnaLoop(ctx, snap, emit);

	// Report outcome to the user.
	if (result.phase === "complete") {
		ctx.addInfoMessage(result.summary || "Yagna completed successfully.");
	} else {
		ctx.addInfoMessage(`\u274c Yagna failed: ${result.error ?? "unknown error"}`);
	}
}

/* ── Argument parsing ────────────────────────────────────────── */

/** Parsed result from the raw args string. */
interface ParsedYagnaArgs {
	topic: string;
	overrides: Partial<YagnaConfig>;
}

/**
 * Parse flag-style arguments from the raw command input.
 *
 * Supports: --rounds=N, --retries=N, --timeout=N (minutes), --no-merge.
 * Everything else is treated as the topic string.
 */
function parseYagnaArgs(raw: string): ParsedYagnaArgs {
	const tokens = raw.trim().split(/\s+/);
	const overrides: Partial<YagnaConfig> = {};
	const topicParts: string[] = [];

	for (const token of tokens) {
		if (token.startsWith("--rounds=")) {
			const val = Number.parseInt(token.slice("--rounds=".length), 10);
			if (!Number.isNaN(val) && val >= 0) overrides.maxTarkaRounds = val;
		} else if (token.startsWith("--retries=")) {
			const val = Number.parseInt(token.slice("--retries=".length), 10);
			if (!Number.isNaN(val) && val >= 0) overrides.maxRetries = val;
		} else if (token.startsWith("--timeout=")) {
			// Input is in minutes; convert to milliseconds.
			const val = Number.parseInt(token.slice("--timeout=".length), 10);
			if (!Number.isNaN(val) && val > 0) overrides.timeoutMs = val * 60 * 1000;
		} else if (token === "--no-merge") {
			overrides.autoMerge = false;
		} else {
			topicParts.push(token);
		}
	}

	return { topic: topicParts.join(" "), overrides };
}

/* ── Usage strings ───────────────────────────────────────────── */

const USAGE_YAGNA = [
	"**Usage:** `/yagna <topic>` [--rounds=N] [--retries=N] [--timeout=M] [--no-merge]",
	"",
	"Launches an autonomous multi-agent Yagna ritual that decomposes the topic,",
	"debates solutions (Tarka), executes in parallel (Kriya), verifies, and merges.",
	"",
	"**Aliases:** `/autopilot`, `/ap`",
	"**Flags:**",
	"  `--rounds=N`    Tarka debate rounds (default: 3)",
	"  `--retries=N`   Max Kriya retries per subtask (default: 2)",
	"  `--timeout=M`   Global timeout in minutes (default: unlimited)",
	"  `--no-merge`    Skip branch merge step",
].join("\n");

const USAGE_TARKA = [
	"**Usage:** `/tarka <topic>` [--rounds=N] [--retries=N] [--timeout=M] [--no-merge]",
	"",
	"Debate-heavy Yagna variant with 5 Tarka rounds by default.",
	"**Aliases:** `/duh`, `/argue`",
].join("\n");

const USAGE_KRIYA = [
	"**Usage:** `/kriya <topic>` [--rounds=N] [--retries=N] [--timeout=M] [--no-merge]",
	"",
	"Blitz-mode Yagna: skips debate, executes immediately.",
	"**Aliases:** `/tf`, `/blitz`",
].join("\n");
