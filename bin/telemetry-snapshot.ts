#!/usr/bin/env tsx
/**
 * takumi-telemetry-snapshot CLI
 * 
 * Aggregates telemetry data from all active Takumi instances.
 * Outputs a TelemetrySnapshot JSON to stdout.
 * 
 * Usage:
 *   takumi-telemetry-snapshot                 # Compact JSON
 *   takumi-telemetry-snapshot --pretty        # Pretty-printed JSON
 *   takumi-telemetry-snapshot --stale-ms 5000 # Custom stale threshold
 *   takumi-telemetry-snapshot | jq .counts    # Pipe to jq
 * 
 * Exit Codes:
 *   0 - Success
 *   1 - Error (connection failed, invalid args, etc.)
 */

import { ChitraguptaBridge } from "@takumi/bridge";

async function main() {
	const args = process.argv.slice(2);

	// Parse --stale-ms flag
	let staleMs = 10000; // Default: 10 seconds
	const staleMsIndex = args.indexOf("--stale-ms");
	if (staleMsIndex !== -1) {
		const staleMsValue = args[staleMsIndex + 1];
		if (!staleMsValue || Number.isNaN(Number(staleMsValue))) {
			console.error("Error: --stale-ms requires a numeric argument");
			process.exit(1);
		}
		staleMs = Number(staleMsValue);
	}

	// Parse --pretty flag
	const pretty = args.includes("--pretty");

	// Show help if requested
	if (args.includes("--help") || args.includes("-h")) {
		console.log(`
takumi-telemetry-snapshot - Aggregate telemetry from all Takumi instances

Usage:
  takumi-telemetry-snapshot [options]

Options:
  --pretty             Pretty-print JSON output
  --stale-ms <ms>      Custom stale threshold in milliseconds (default: 10000)
  -h, --help           Show this help message

Examples:
  takumi-telemetry-snapshot
  takumi-telemetry-snapshot --pretty
  takumi-telemetry-snapshot --stale-ms 5000
  takumi-telemetry-snapshot | jq '.counts'
  watch -n 1 "takumi-telemetry-snapshot --pretty"
    `);
		process.exit(0);
	}

	// Create bridge (telemetry snapshot is file-based)
	const bridge = new ChitraguptaBridge();

	try {
		// Get snapshot (no need to connect, telemetry is file-based)
		const snapshot = await bridge.telemetrySnapshot(staleMs);

		// Output JSON
		const output = pretty ? JSON.stringify(snapshot, null, 2) : JSON.stringify(snapshot);
		console.log(output);

		process.exit(0);
	} catch (err) {
		console.error(`Error: ${(err as Error).message}`);
		process.exit(1);
	}
}

main();
