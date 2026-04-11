/**
 * Canonical route command surface.
 *
 * I keep routing decision formatting in one place so `/route` and legacy
 * `/lane` compatibility stop teaching two different mental models. The goal is
 * simple: `/route` owns routing drill-down, `/lanes` owns tracked side lanes,
 * and operators do not have to guess which noun is lying to them today.
 */

import type { RoutingDecision } from "@takumi/bridge";
import type { AppCommandContext } from "./app-command-context.js";

const MAX_ROUTE_ROWS = 10;
const ROUTE_USAGE = [
	"Usage:",
	"  /route                  — list recent routing decisions",
	"  /route list             — compact routing table",
	"  /route summary          — routing authority overview",
	"  /route inspect <#>      — inspect a specific routing decision",
	"  /route <capability>     — filter routing decisions by capability",
	"  /lanes                  — list tracked side lanes",
	"  /lane-show <id>         — inspect a tracked side lane",
].join("\n");

const LEGACY_LANE_USAGE = [
	"## Lane Command Surface",
	"",
	"Routing drill-down now lives under `/route`.",
	"Tracked side-lane operations live under `/lanes` and `/lane-*`.",
	"",
	ROUTE_USAGE,
	"",
	"Compatibility note: old `/lane <route-subcommand>` invocations still work for now.",
].join("\n");

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

function truncate(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text;
	if (maxLength <= 1) return text.slice(0, maxLength);
	return `${text.slice(0, maxLength - 1)}…`;
}

function formatRouteTarget(decision: RoutingDecision): string {
	const label = stripAnsi(decision.selected?.label ?? "");
	if (label) return label;

	const metadata = decision.selected?.metadata as Record<string, unknown> | undefined;
	const model =
		typeof metadata?.model === "string"
			? metadata.model
			: typeof metadata?.modelId === "string"
				? metadata.modelId
				: undefined;
	const provider = stripAnsi(decision.selected?.providerFamily ?? "");
	if (provider && model) {
		return `${provider}/${model}`;
	}
	if (model) return model;
	return stripAnsi(decision.selected?.id ?? "local fallback");
}

function getAuthority(decision: RoutingDecision): "engine" | "takumi-fallback" {
	return decision.selected ? "engine" : "takumi-fallback";
}

function getEnforcement(decision: RoutingDecision): "same-provider" | "capability-only" {
	return decision.selected ? "same-provider" : "capability-only";
}

function formatRouteList(decisions: RoutingDecision[]): string {
	const rows = decisions
		.slice(-MAX_ROUTE_ROWS)
		.reverse()
		.map((decision, index) => {
			const icon = decision.degraded === true ? "⚠" : decision.selected ? "✦" : "↩";
			const authority = getAuthority(decision) === "engine" ? "engine" : "fallback";
			const enforcement = decision.selected ? "SP" : "CO";
			const capability = stripAnsi(decision.request?.capability ?? "unknown");
			const target = truncate(formatRouteTarget(decision), 30);
			return `  ${String(index + 1).padStart(2)}  ${icon} ${authority.padEnd(8)} ${enforcement}  ${capability.padEnd(24)} ${target}`;
		});

	return [
		`## Route Surface (${rows.length})`,
		"",
		`  ${"#".padStart(4)}  ${"State".padEnd(9)} Enf  ${"Capability".padEnd(24)} Target`,
		`  ${"─".repeat(4)}  ${"─".repeat(9)} ${"─".repeat(3)}  ${"─".repeat(24)} ${"─".repeat(24)}`,
		...rows,
	].join("\n");
}

function formatRouteSummary(decisions: RoutingDecision[]): string {
	const total = decisions.length;
	const degradedCount = decisions.filter((decision) => decision.degraded === true).length;
	const engineCount = decisions.filter((decision) => decision.selected !== null).length;
	const fallbackCount = total - engineCount;
	const latest = decisions.at(-1);
	const latestLine = latest
		? `Latest: ${latest.degraded === true ? "⚠" : latest.selected ? "✦" : "↩"} ${getAuthority(latest)} [${latest.selected ? "SP" : "CO"}] ${stripAnsi(latest.request?.capability ?? "unknown")} → ${formatRouteTarget(latest)}`
		: "Latest: none";

	return [
		"## Route Summary",
		"",
		`Total decisions: ${total}`,
		`Engine-routed:   ${engineCount} (${total > 0 ? Math.round((engineCount / total) * 100) : 0}%)`,
		`Local fallback:  ${fallbackCount} (${total > 0 ? Math.round((fallbackCount / total) * 100) : 0}%)`,
		`Degraded:        ${degradedCount} (${total > 0 ? Math.round((degradedCount / total) * 100) : 0}%)`,
		latestLine,
		"",
		"Drill down: /route inspect <#> • /lanes • /lane-show <id>",
	].join("\n");
}

function formatRouteDetail(decision: RoutingDecision, ordinal: number): string {
	const lines = [
		`## Route #${ordinal}`,
		"",
		`Capability: ${stripAnsi(decision.request?.capability ?? "unknown")}`,
		`Consumer: ${stripAnsi(decision.request?.consumer ?? "—")}`,
		`Authority: ${getAuthority(decision)}`,
		`Enforcement: ${getEnforcement(decision)}`,
		`Target: ${formatRouteTarget(decision)}`,
		`Degraded: ${decision.degraded === true ? "yes" : "no"}`,
		`Reason: ${stripAnsi(decision.reason ?? "—")}`,
	];

	if (decision.selected) {
		lines.push(
			"",
			"### Selected capability",
			`- ID: ${stripAnsi(decision.selected.id ?? "—")}`,
			`- Label: ${stripAnsi(decision.selected.label ?? "—")}`,
			`- Family: ${stripAnsi(decision.selected.providerFamily ?? "—")}`,
			`- Health: ${stripAnsi(String(decision.selected.health ?? "—"))}`,
			`- Cost: ${stripAnsi(decision.selected.costClass ?? "—")}`,
		);
	}

	if (decision.fallbackChain.length > 0) {
		lines.push("", "### Fallback chain", ...decision.fallbackChain.map((item) => `- ${stripAnsi(item)}`));
	}

	if (decision.policyTrace.length > 0) {
		lines.push("", "### Policy trace", ...decision.policyTrace.map((item) => `- ${stripAnsi(item)}`));
	}

	return lines.join("\n");
}

function filterDecisions(decisions: RoutingDecision[], query: string): RoutingDecision[] {
	const normalized = query.toLowerCase();
	return decisions.filter((decision) => {
		const capability = decision.request?.capability?.toLowerCase() ?? "";
		const target = formatRouteTarget(decision).toLowerCase();
		const reason = (decision.reason ?? "").toLowerCase();
		return capability.includes(normalized) || target.includes(normalized) || reason.includes(normalized);
	});
}

function formatRouteFilter(decisions: RoutingDecision[], query: string): string {
	const rows = decisions
		.slice(-MAX_ROUTE_ROWS)
		.reverse()
		.map((decision, index) => {
			const icon = decision.degraded === true ? "⚠" : decision.selected ? "✦" : "↩";
			const target = truncate(formatRouteTarget(decision), 28);
			return `  ${icon} ${String(index + 1).padStart(2)}  ${stripAnsi(decision.request?.capability ?? "unknown").padEnd(24)} ${target}`;
		});
	return [`## Routes matching "${stripAnsi(query)}" (${rows.length})`, "", ...rows].join("\n");
}

function getRecentCapabilities(decisions: RoutingDecision[]): string[] {
	return Array.from(
		new Set(
			decisions
				.map((decision) => decision.request?.capability)
				.filter((capability): capability is string => typeof capability === "string" && capability.length > 0),
		),
	).slice(-8);
}

function getRouteArgumentCompletions(ctx: AppCommandContext, partial: string, includeHelp = false): string[] {
	const decisions = ctx.state.routingDecisions.value;
	const subcommands = ["list", "summary", "inspect ", ...(includeHelp ? ["help"] : [])];
	const normalized = partial.trimStart();
	const hasTrailingSpace = /\s$/.test(partial);
	if (!normalized) {
		return [...subcommands, ...getRecentCapabilities(decisions)];
	}

	const tokens = normalized.split(/\s+/);
	const subcommand = tokens[0].toLowerCase();
	if (tokens.length === 1 && !hasTrailingSpace) {
		return [...subcommands, ...getRecentCapabilities(decisions)].filter((value) => value.startsWith(subcommand));
	}

	if (["inspect", "detail"].includes(subcommand)) {
		const prefix = hasTrailingSpace ? "" : (tokens[1] ?? "");
		return decisions
			.slice(-MAX_ROUTE_ROWS)
			.reverse()
			.map((_decision, index) => String(index + 1))
			.filter((value) => value.startsWith(prefix));
	}

	return [];
}

function executeCanonicalRouteSurface(ctx: AppCommandContext, args: string): void {
	const decisions = ctx.state.routingDecisions.value;
	if (decisions.length === 0) {
		ctx.addInfoMessage("No routing decisions recorded yet. Use /lanes for tracked side lanes.");
		return;
	}

	const sub = args.trim().toLowerCase();
	if (!sub || sub === "list") {
		ctx.addInfoMessage(formatRouteList(decisions));
		return;
	}

	if (sub === "summary") {
		ctx.addInfoMessage(formatRouteSummary(decisions));
		return;
	}

	if (sub.startsWith("inspect") || sub.startsWith("detail")) {
		const indexText = sub.replace(/^(inspect|detail)\s*/, "").trim();
		const parsed = Number.parseInt(indexText, 10);
		const reversed = decisions.slice(-MAX_ROUTE_ROWS).reverse();
		if (!indexText || Number.isNaN(parsed)) {
			ctx.addInfoMessage("Usage: /route inspect <number> (for example: `/route inspect 1`).");
			return;
		}
		if (parsed < 1 || parsed > reversed.length) {
			ctx.addInfoMessage(`Route index out of range (1–${reversed.length}).`);
			return;
		}
		ctx.addInfoMessage(formatRouteDetail(reversed[parsed - 1], parsed));
		return;
	}

	const filtered = filterDecisions(decisions, sub);
	if (filtered.length === 0) {
		ctx.addInfoMessage(`${ROUTE_USAGE}\n\nNo routes matched "${stripAnsi(sub)}".`);
		return;
	}
	ctx.addInfoMessage(formatRouteFilter(filtered, sub));
}

/** Register the canonical routing drill-down command. */
export function registerRouteCommand(ctx: AppCommandContext): void {
	ctx.commands.register(
		"/route",
		"Inspect routing decisions, authority, and fallback state",
		(args) => {
			if (args.trim().toLowerCase() === "help") {
				ctx.addInfoMessage(ROUTE_USAGE);
				return;
			}
			executeCanonicalRouteSurface(ctx, args);
		},
		{ getArgumentCompletions: (partial) => getRouteArgumentCompletions(ctx, partial) },
	);
}

/**
 * Register the legacy `/lane` compatibility shim.
 *
 * I keep the old route subcommands working during the transition, but I stop
 * pretending `/lanes` should mean routing history when side-lane operators
 * already own that noun.
 */
export function registerLegacyLaneCommand(ctx: AppCommandContext): void {
	ctx.commands.register(
		"/lane",
		"Legacy compatibility shim for routing decisions; prefer /route",
		(args) => {
			const trimmed = args.trim();
			if (!trimmed || trimmed.toLowerCase() === "help") {
				ctx.addInfoMessage(LEGACY_LANE_USAGE);
				return;
			}
			executeCanonicalRouteSurface(ctx, trimmed);
		},
		{ getArgumentCompletions: (partial) => getRouteArgumentCompletions(ctx, partial, true) },
	);
}
