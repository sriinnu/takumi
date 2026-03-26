/**
 * Command lease helpers.
 *
 * I keep one shared execution gate for slash commands so macros, coding, and
 * autocycle surfaces all report the same reason when the runtime is busy.
 */

import type { AppCommandContext } from "./app-command-context.js";

export function ensureExclusiveCommandLease(ctx: AppCommandContext, commandName: string): boolean {
	const blocker = describeLeaseBlocker(ctx);
	if (!blocker) {
		return true;
	}

	ctx.addInfoMessage(`${commandName} is unavailable while ${blocker}.`);
	return false;
}

function describeLeaseBlocker(ctx: AppCommandContext): string | null {
	if (ctx.agentRunner?.isRunning) {
		return "the main agent run is active";
	}
	if (ctx.getActiveCoder()?.isActive) {
		return "the coding lane is active";
	}
	if (ctx.getActiveAutocycle()?.isActive) {
		return "the autocycle lane is active";
	}
	return null;
}
