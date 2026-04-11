#!/usr/bin/env node

/**
 * Enforces the Takumi source-file line-count guardrail.
 *
 * Policy:
 * - No production source file may exceed MAX_SOURCE_LINES.
 * - Test/spec files are excluded.
 * - Generated declaration files are excluded.
 * - Historical debt gets a dated ratchet instead of a permanent freeze.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";

const MAX_SOURCE_LINES = 450;
const ROOT = process.cwd();
const SOURCE_DIRS = ["bin", "packages", "apps"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const BASELINE_PATH = join(ROOT, "scripts", "guard-loc-baseline.json");
const BASELINE_SCHEMA_VERSION = 1;
const DEFAULT_RATCHET_LINES = 25;
const DEFAULT_RATCHET_EVERY_DAYS = 30;
const TODAY_OVERRIDE_ENV = "TAKUMI_LOC_GUARD_TODAY";

/**
 * Returns true when a path points to a source file that should be checked.
 */
function isTrackableSourceFile(filePath) {
	const ext = extname(filePath);
	if (!SOURCE_EXTENSIONS.has(ext)) return false;
	if (filePath.endsWith(".d.ts")) return false;
	if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(filePath)) return false;
	if (filePath.includes("/node_modules/")) return false;
	if (filePath.includes("/dist/")) return false;
	return true;
}

/**
 * Recursively collects all files under a directory.
 */
async function walkFiles(dirPath, out = []) {
	const entries = await readdir(dirPath, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = join(dirPath, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "node_modules" || entry.name === "dist") continue;
			await walkFiles(fullPath, out);
			continue;
		}
		out.push(fullPath);
	}
	return out;
}

/**
 * Counts logical lines in a UTF-8 text file.
 */
async function countLines(filePath) {
	const content = await readFile(filePath, "utf-8");
	if (content.length === 0) return 0;
	return content.split("\n").length;
}

/**
 * Returns true when the value is a plain object.
 */
function isPlainObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Returns true when the value is a positive integer.
 */
function isPositiveInteger(value) {
	return Number.isInteger(value) && value > 0;
}

/**
 * Returns true when the value matches YYYY-MM-DD.
 */
function isIsoDate(value) {
	return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Parses an ISO date string into a UTC date.
 */
function parseIsoDateUtc(value) {
	if (!isIsoDate(value)) {
		throw new Error(`Expected YYYY-MM-DD, received "${value}".`);
	}
	const [year, month, day] = value.split("-").map(Number);
	return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Formats a date as YYYY-MM-DD in UTC.
 */
function formatIsoDateUtc(value) {
	return value.toISOString().slice(0, 10);
}

/**
 * Adds a whole number of UTC days to an ISO date.
 */
function addUtcDays(isoDate, days) {
	const date = parseIsoDateUtc(isoDate);
	date.setUTCDate(date.getUTCDate() + days);
	return formatIsoDateUtc(date);
}

/**
 * Returns the whole UTC day delta between two ISO dates.
 */
function diffUtcDays(startIsoDate, endIsoDate) {
	const start = parseIsoDateUtc(startIsoDate).getTime();
	const end = parseIsoDateUtc(endIsoDate).getTime();
	return Math.floor((end - start) / 86_400_000);
}

/**
 * Returns today's ISO date, optionally pinned for tests.
 */
function getTodayIsoDate() {
	const override = process.env[TODAY_OVERRIDE_ENV];
	if (typeof override === "string" && override.length > 0) {
		parseIsoDateUtc(override);
		return override;
	}
	return formatIsoDateUtc(new Date());
}

/**
 * Converts an absolute path back to a repo-relative path.
 */
function toRelativePath(filePath) {
	return filePath.startsWith(`${ROOT}/`) ? filePath.slice(ROOT.length + 1) : filePath;
}

/**
 * Builds an empty baseline metadata shape.
 */
function createEmptyBaseline(recordedAt) {
	return {
		version: BASELINE_SCHEMA_VERSION,
		recordedAt,
		defaults: {
			ratchetLines: DEFAULT_RATCHET_LINES,
			ratchetEveryDays: DEFAULT_RATCHET_EVERY_DAYS,
		},
		entries: {},
	};
}

/**
 * Loads and validates the LOC debt metadata.
 */
async function loadBaseline(recordedAt) {
	try {
		const content = await readFile(BASELINE_PATH, "utf-8");
		const parsed = JSON.parse(content);
		if (!isPlainObject(parsed)) {
			throw new Error("baseline metadata must be a JSON object");
		}
		if (parsed.version !== BASELINE_SCHEMA_VERSION) {
			throw new Error(`expected schema version ${BASELINE_SCHEMA_VERSION}`);
		}
		if (!isIsoDate(parsed.recordedAt)) {
			throw new Error('baseline metadata requires a top-level "recordedAt" date');
		}
		if (!isPlainObject(parsed.defaults)) {
			throw new Error('baseline metadata requires a top-level "defaults" object');
		}
		if (!isPlainObject(parsed.entries)) {
			throw new Error('baseline metadata requires a top-level "entries" object');
		}
		const defaults = {
			ratchetLines: parsed.defaults.ratchetLines ?? DEFAULT_RATCHET_LINES,
			ratchetEveryDays: parsed.defaults.ratchetEveryDays ?? DEFAULT_RATCHET_EVERY_DAYS,
		};
		if (!isPositiveInteger(defaults.ratchetLines)) {
			throw new Error('"defaults.ratchetLines" must be a positive integer');
		}
		if (!isPositiveInteger(defaults.ratchetEveryDays)) {
			throw new Error('"defaults.ratchetEveryDays" must be a positive integer');
		}
		const entries = {};
		for (const [relPath, rawEntry] of Object.entries(parsed.entries)) {
			if (!isPlainObject(rawEntry)) {
				throw new Error(`baseline entry "${relPath}" must be an object`);
			}
			if (!isPositiveInteger(rawEntry.baselineLines) || rawEntry.baselineLines <= MAX_SOURCE_LINES) {
				throw new Error(`baseline entry "${relPath}" must declare "baselineLines" above ${MAX_SOURCE_LINES}`);
			}
			if (rawEntry.ratchetLines !== undefined && !isPositiveInteger(rawEntry.ratchetLines)) {
				throw new Error(`baseline entry "${relPath}" has an invalid "ratchetLines" override`);
			}
			if (rawEntry.ratchetEveryDays !== undefined && !isPositiveInteger(rawEntry.ratchetEveryDays)) {
				throw new Error(`baseline entry "${relPath}" has an invalid "ratchetEveryDays" override`);
			}
			entries[relPath] = {
				baselineLines: rawEntry.baselineLines,
				ratchetLines: rawEntry.ratchetLines,
				ratchetEveryDays: rawEntry.ratchetEveryDays,
			};
		}
		return {
			version: BASELINE_SCHEMA_VERSION,
			recordedAt: parsed.recordedAt,
			defaults,
			entries,
		};
	} catch (error) {
		if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
			return createEmptyBaseline(recordedAt);
		}
		throw error;
	}
}

/**
 * Computes the current LOC allowance and next target for a debt entry.
 */
function buildDebtStatus(entry, defaults, recordedAt, today) {
	const ratchetLines = entry.ratchetLines ?? defaults.ratchetLines;
	const ratchetEveryDays = entry.ratchetEveryDays ?? defaults.ratchetEveryDays;
	const daysElapsed = Math.max(0, diffUtcDays(recordedAt, today));
	const ratchetStepsApplied = Math.floor(daysElapsed / ratchetEveryDays);
	const currentAllowedLines = Math.max(MAX_SOURCE_LINES, entry.baselineLines - ratchetStepsApplied * ratchetLines);
	const nextTargetLines = Math.max(MAX_SOURCE_LINES, currentAllowedLines - ratchetLines);
	const nextTargetBy = currentAllowedLines === MAX_SOURCE_LINES && nextTargetLines === MAX_SOURCE_LINES
		? null
		: addUtcDays(recordedAt, (ratchetStepsApplied + 1) * ratchetEveryDays);
	return {
		currentAllowedLines,
		nextTargetLines,
		nextTargetBy,
	};
}

/**
 * Formats the debt status for human-readable output.
 */
function formatDebtStatus(status) {
	if (!status.nextTargetBy) {
		return `allowed ${status.currentAllowedLines}; debt window is exhausted`;
	}
	return `allowed ${status.currentAllowedLines}, next target ${status.nextTargetLines} by ${status.nextTargetBy}`;
}

/**
 * Collects all trackable source files and their current line counts.
 */
async function collectSourceFileState() {
	const candidates = [];
	for (const dir of SOURCE_DIRS) {
		const full = join(ROOT, dir);
		try {
			const info = await stat(full);
			if (!info.isDirectory()) continue;
			const files = await walkFiles(full);
			candidates.push(...files.filter(isTrackableSourceFile));
		} catch {
			// Directory is optional in some workspaces.
		}
	}
	const lineCounts = new Map();
	const offenders = [];
	for (const filePath of candidates) {
		const rel = toRelativePath(filePath);
		const lines = await countLines(filePath);
		lineCounts.set(rel, lines);
		if (lines > MAX_SOURCE_LINES) {
			offenders.push({ rel, lines });
		}
	}
	offenders.sort((left, right) => right.lines - left.lines || left.rel.localeCompare(right.rel));
	return { lineCounts, offenders };
}

/**
 * Returns baseline entries that no longer need debt tracking.
 */
function collectResolvedEntries(lineCounts, baselineEntries) {
	return Object.keys(baselineEntries)
		.filter((rel) => {
			const lines = lineCounts.get(rel);
			return lines === undefined || lines <= MAX_SOURCE_LINES;
		})
		.sort((left, right) => left.localeCompare(right));
}

/**
 * Prints metadata cleanup notes for resolved debt entries.
 */
function printResolvedEntriesNotice(resolvedEntries, writer) {
	if (resolvedEntries.length === 0) return;
	writer(
		`LOC guard note: ${resolvedEntries.length} debt entr${resolvedEntries.length === 1 ? "y is" : "ies are"} resolved and can be removed from ${toRelativePath(BASELINE_PATH)}:`,
	);
	for (const rel of resolvedEntries) {
		writer(`  - ${rel}`);
	}
}

async function main() {
	const today = getTodayIsoDate();
	const baseline = await loadBaseline(today);
	const { lineCounts, offenders } = await collectSourceFileState();
	const resolvedEntries = collectResolvedEntries(lineCounts, baseline.entries);
	const regressions = [];
	const grandfathered = [];

	for (const offender of offenders) {
		const entry = baseline.entries[offender.rel];
		if (!entry) {
			regressions.push({ ...offender, status: null });
			continue;
		}
		const status = buildDebtStatus(entry, baseline.defaults, baseline.recordedAt, today);
		if (offender.lines <= status.currentAllowedLines) {
			grandfathered.push({ ...offender, status });
			continue;
		}
		regressions.push({ ...offender, status });
	}

	if (regressions.length === 0) {
		if (grandfathered.length === 0) {
			console.log(`LOC guard passed. All tracked source files are <= ${MAX_SOURCE_LINES} lines.`);
			printResolvedEntriesNotice(resolvedEntries, console.log);
			return;
		}
		console.log(
			`LOC guard passed with ${grandfathered.length} ratcheted debt entr${grandfathered.length === 1 ? "y" : "ies"} still above ${MAX_SOURCE_LINES} lines.`,
		);
		for (const offender of grandfathered) {
			console.log(`  - ${offender.rel}: ${offender.lines} lines (${formatDebtStatus(offender.status)})`);
		}
		printResolvedEntriesNotice(resolvedEntries, console.log);
		return;
	}

	console.error(`LOC guard failed. ${regressions.length} source files exceed the current LOC allowance:`);
	for (const offender of regressions) {
		if (!offender.status) {
			console.error(`  - ${offender.rel}: ${offender.lines} lines (new offender, max ${MAX_SOURCE_LINES})`);
			continue;
		}
		console.error(`  - ${offender.rel}: ${offender.lines} lines (${formatDebtStatus(offender.status)})`);
	}
	printResolvedEntriesNotice(resolvedEntries, console.error);
	process.exit(1);
}

main().catch((error) => {
	console.error(`LOC guard crashed: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
