#!/usr/bin/env tsx
/**
 * Phase 18 Integration Test: Memory scopes and daemon status methods.
 */

import { ChitraguptaBridge } from "../packages/bridge/src/chitragupta.js";

async function main() {
	console.log("🧠 Testing Phase 18: Advanced Memory Features\n");
	
	const bridge = new ChitraguptaBridge({
		projectPath: process.cwd(),
	});

	try {
		await bridge.connect();
		console.log(`✅ Connected! Mode: ${bridge.isSocketMode ? "socket (fast)" : "MCP subprocess"}\n`);

		// 1. Memory Scopes
		try {
			const scopes = await bridge.memoryScopes();
			console.log(`  memoryScopes(): ${scopes.length} scopes`);
			if (scopes.length > 0) {
				scopes.forEach(scope => {
					if (scope.type === "global") {
						console.log(`    → global scope`);
					} else {
						console.log(`    → project scope: ${scope.path}`);
					}
				});
			}
		} catch (err: any) {
			console.log(`  memoryScopes(): ⚠️  ${err.message}`);
		}

		console.log();

		// 2. Daemon Status
		try {
			const status = await bridge.daemonStatus();
			if (status) {
				console.log(`  daemonStatus():`);
				console.log(`    → Timestamp: ${new Date(status.timestamp).toISOString()}`);
				console.log(`    → Turns: ${status.counts.turns}`);
				console.log(`    → Sessions: ${status.counts.sessions}`);
				console.log(`    → Vidhis: ${status.counts.vidhis}`);
				console.log(`    → Vasanas: ${status.counts.vasanas}`);
				console.log(`    → Akasha Traces: ${status.counts.akashaTraces}`);
			} else {
				console.log(`  daemonStatus(): null (not available)`);
			}
		} catch (err: any) {
			console.log(`  daemonStatus(): ⚠️  ${err.message}`);
		}

		console.log("\n✨ Phase 18 testing complete!");

	} catch (error: any) {
		console.error(`\n❌ Error: ${error.message}`);
		console.error(`\nStack: ${error.stack}`);
		process.exit(1);
	} finally {
		await bridge.disconnect();
	}
}

main();
