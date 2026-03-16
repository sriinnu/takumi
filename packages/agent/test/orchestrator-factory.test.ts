import { describe, expect, it } from "vitest";
import { createOrchestrator } from "../src/cluster/orchestrator-factory.js";
import { ProcessOrchestrator } from "../src/cluster/process-orchestrator.js";
import { TmuxOrchestrator } from "../src/cluster/tmux-orchestrator.js";

describe("createOrchestrator", () => {
	it("returns either TmuxOrchestrator or ProcessOrchestrator", async () => {
		const orch = await createOrchestrator("test-factory");
		const isTmux = orch instanceof TmuxOrchestrator;
		const isProcess = orch instanceof ProcessOrchestrator;
		expect(isTmux || isProcess).toBe(true);

		// Cleanup — only TmuxOrchestrator has cleanup()
		if (isTmux) {
			await (orch as TmuxOrchestrator).cleanup();
		} else {
			await (orch as ProcessOrchestrator).destroyAll();
		}
	});

	it("ProcessOrchestrator is always a valid fallback", async () => {
		const proc = new ProcessOrchestrator();
		expect(await ProcessOrchestrator.isAvailable()).toBe(true);
		await proc.destroyAll();
	});
});
