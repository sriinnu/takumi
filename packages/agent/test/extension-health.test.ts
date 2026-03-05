/**
 * Tests for ExtensionHealthMonitor — Phase 52
 */

import { describe, expect, it } from "vitest";
import { ExtensionHealthMonitor, type HealthEvent, type HealthTransition } from "../src/extensions/extension-health.js";

function makeEvent(path: string, overrides: Partial<HealthEvent> = {}): HealthEvent {
	return {
		extensionPath: path,
		eventType: "agent_start",
		durationMs: 5,
		success: true,
		timestamp: Date.now(),
		...overrides,
	};
}

describe("ExtensionHealthMonitor", () => {
	// ── Basic recording ──────────────────────────────────────────────────────

	it("tracks events and returns snapshot", () => {
		const m = new ExtensionHealthMonitor();
		const now = 1_000_000;
		m.recordEvent(makeEvent("/ext/a", { timestamp: now, durationMs: 10 }));
		m.recordEvent(makeEvent("/ext/a", { timestamp: now + 1, durationMs: 20 }));

		const snap = m.getSnapshot("/ext/a", now + 2);
		expect(snap).not.toBeNull();
		expect(snap!.totalEvents).toBe(2);
		expect(snap!.totalErrors).toBe(0);
		expect(snap!.status).toBe("active");
		expect(snap!.errorRate).toBe(0);
	});

	it("returns null for unknown extension", () => {
		const m = new ExtensionHealthMonitor();
		expect(m.getSnapshot("/ext/unknown")).toBeNull();
	});

	it("tracks error counts", () => {
		const m = new ExtensionHealthMonitor();
		const now = 1_000_000;
		m.recordEvent(makeEvent("/ext/b", { timestamp: now, success: false }));
		m.recordEvent(makeEvent("/ext/b", { timestamp: now + 1, success: true }));
		m.recordEvent(makeEvent("/ext/b", { timestamp: now + 2, success: false }));

		const snap = m.getSnapshot("/ext/b", now + 3);
		expect(snap!.totalErrors).toBe(2);
		expect(snap!.windowErrors).toBe(2);
		expect(snap!.errorRate).toBeCloseTo(2 / 3);
	});

	// ── Quarantine ───────────────────────────────────────────────────────────

	it("auto-quarantines when error rate exceeds threshold", () => {
		const m = new ExtensionHealthMonitor({
			quarantineThreshold: 0.5,
			quarantineMinEvents: 4,
		});
		const now = 1_000_000;

		// 3/4 errors = 75% rate > 50% threshold
		m.recordEvent(makeEvent("/ext/c", { timestamp: now, success: false }));
		m.recordEvent(makeEvent("/ext/c", { timestamp: now + 1, success: false }));
		m.recordEvent(makeEvent("/ext/c", { timestamp: now + 2, success: false }));
		m.recordEvent(makeEvent("/ext/c", { timestamp: now + 3, success: true }));

		const snap = m.getSnapshot("/ext/c", now + 4);
		expect(snap!.status).toBe("quarantined");
		expect(m.isActive("/ext/c")).toBe(false);
	});

	it("does not quarantine below min events", () => {
		const m = new ExtensionHealthMonitor({
			quarantineThreshold: 0.5,
			quarantineMinEvents: 10,
		});
		const now = 1_000_000;
		// 3/3 errors but below min
		m.recordEvent(makeEvent("/ext/d", { timestamp: now, success: false }));
		m.recordEvent(makeEvent("/ext/d", { timestamp: now + 1, success: false }));
		m.recordEvent(makeEvent("/ext/d", { timestamp: now + 2, success: false }));

		expect(m.isActive("/ext/d")).toBe(true);
	});

	it("manual quarantine and reinstate", () => {
		const m = new ExtensionHealthMonitor();
		m.recordEvent(makeEvent("/ext/e"));
		m.quarantine("/ext/e", "testing");
		expect(m.isActive("/ext/e")).toBe(false);
		expect(m.getQuarantined()).toContain("/ext/e");

		m.reinstate("/ext/e");
		expect(m.isActive("/ext/e")).toBe(true);
		expect(m.getQuarantined()).not.toContain("/ext/e");
	});

	it("auto-reinstates after max quarantine duration", () => {
		const m = new ExtensionHealthMonitor({ maxQuarantineMs: 1000 });
		m.recordEvent(makeEvent("/ext/f"));
		m.quarantine("/ext/f", "test");

		// Not yet
		m.checkReinstatement(Date.now());
		expect(m.isActive("/ext/f")).toBe(false);

		// After max duration
		m.checkReinstatement(Date.now() + 2000);
		expect(m.isActive("/ext/f")).toBe(true);
	});

	// ── Hibernation ──────────────────────────────────────────────────────────

	it("hibernates idle extensions", () => {
		const m = new ExtensionHealthMonitor({ hibernateAfterMs: 1000 });
		const now = 1_000_000;
		m.recordEvent(makeEvent("/ext/g", { timestamp: now }));

		// Not yet idle
		m.checkHibernation(now + 500);
		expect(m.getSnapshot("/ext/g", now + 500)!.status).toBe("active");

		// Now idle
		m.checkHibernation(now + 1500);
		expect(m.getSnapshot("/ext/g", now + 1500)!.status).toBe("hibernated");
		expect(m.getHibernated()).toContain("/ext/g");
	});

	it("awakens hibernated extension on activity", () => {
		const m = new ExtensionHealthMonitor({ hibernateAfterMs: 500 });
		const now = 1_000_000;
		m.recordEvent(makeEvent("/ext/h", { timestamp: now }));
		m.checkHibernation(now + 1000);
		expect(m.getSnapshot("/ext/h", now + 1000)!.status).toBe("hibernated");

		// New event awakens it
		m.recordEvent(makeEvent("/ext/h", { timestamp: now + 2000 }));
		expect(m.getSnapshot("/ext/h", now + 2000)!.status).toBe("active");
	});

	// ── Latency ──────────────────────────────────────────────────────────────

	it("computes latency percentiles", () => {
		const m = new ExtensionHealthMonitor();
		const now = 1_000_000;
		// Record 100 events with durations 1..100
		for (let i = 1; i <= 100; i++) {
			m.recordEvent(makeEvent("/ext/latency", { timestamp: now + i, durationMs: i }));
		}

		const snap = m.getSnapshot("/ext/latency", now + 200);
		expect(snap!.latencyP50Ms).toBe(50);
		expect(snap!.latencyP95Ms).toBe(95);
		expect(snap!.latencyP99Ms).toBe(99);
	});

	// ── Sliding window eviction ──────────────────────────────────────────────

	it("evicts old events from sliding window", () => {
		const m = new ExtensionHealthMonitor({ windowMs: 1000 });
		const now = 1_000_000;

		// Old events (outside window)
		m.recordEvent(makeEvent("/ext/win", { timestamp: now, success: false }));
		m.recordEvent(makeEvent("/ext/win", { timestamp: now + 100, success: false }));

		// Recent events (inside window)
		m.recordEvent(makeEvent("/ext/win", { timestamp: now + 1500, success: true }));
		m.recordEvent(makeEvent("/ext/win", { timestamp: now + 1600, success: true }));

		const snap = m.getSnapshot("/ext/win", now + 1700);
		// Total includes all, but window only has recent
		expect(snap!.totalEvents).toBe(4);
		expect(snap!.totalErrors).toBe(2);
		expect(snap!.windowEvents).toBe(2);
		expect(snap!.windowErrors).toBe(0);
		expect(snap!.errorRate).toBe(0); // window-based
	});

	// ── Transition listeners ─────────────────────────────────────────────────

	it("fires transition events on quarantine and reinstate", () => {
		const m = new ExtensionHealthMonitor();
		const transitions: HealthTransition[] = [];
		m.onTransition((t) => transitions.push(t));

		m.recordEvent(makeEvent("/ext/t"));
		m.quarantine("/ext/t", "test");
		m.reinstate("/ext/t");

		expect(transitions).toHaveLength(2);
		expect(transitions[0].type).toBe("quarantined");
		expect(transitions[1].type).toBe("reinstated");
	});

	it("fires hibernation and awakened transitions", () => {
		const m = new ExtensionHealthMonitor({ hibernateAfterMs: 500 });
		const transitions: HealthTransition[] = [];
		m.onTransition((t) => transitions.push(t));

		const now = 1_000_000;
		m.recordEvent(makeEvent("/ext/u", { timestamp: now }));
		m.checkHibernation(now + 1000);
		m.recordEvent(makeEvent("/ext/u", { timestamp: now + 2000 }));

		expect(transitions).toHaveLength(2);
		expect(transitions[0].type).toBe("hibernated");
		expect(transitions[1].type).toBe("awakened");
	});

	it("unsubscribe removes listener", () => {
		const m = new ExtensionHealthMonitor();
		const transitions: HealthTransition[] = [];
		const unsub = m.onTransition((t) => transitions.push(t));

		m.recordEvent(makeEvent("/ext/v"));
		m.quarantine("/ext/v", "test");
		expect(transitions).toHaveLength(1);

		unsub();
		m.reinstate("/ext/v");
		expect(transitions).toHaveLength(1); // no new event
	});

	// ── Aggregate queries ────────────────────────────────────────────────────

	it("getAllSnapshots returns all tracked extensions", () => {
		const m = new ExtensionHealthMonitor();
		m.recordEvent(makeEvent("/ext/x"));
		m.recordEvent(makeEvent("/ext/y"));
		m.recordEvent(makeEvent("/ext/z"));

		const snaps = m.getAllSnapshots();
		expect(snaps).toHaveLength(3);
		expect(snaps.map((s) => s.extensionPath).sort()).toEqual(["/ext/x", "/ext/y", "/ext/z"]);
	});

	it("trackedCount reflects unique extensions", () => {
		const m = new ExtensionHealthMonitor();
		m.recordEvent(makeEvent("/ext/a"));
		m.recordEvent(makeEvent("/ext/a"));
		m.recordEvent(makeEvent("/ext/b"));
		expect(m.trackedCount).toBe(2);
	});

	it("isActive returns true for unknown extensions", () => {
		const m = new ExtensionHealthMonitor();
		expect(m.isActive("/ext/unknown")).toBe(true);
	});

	// ── Auto-quarantine fires transition ─────────────────────────────────────

	it("auto-quarantine fires quarantined transition", () => {
		const m = new ExtensionHealthMonitor({
			quarantineThreshold: 0.5,
			quarantineMinEvents: 3,
		});
		const transitions: HealthTransition[] = [];
		m.onTransition((t) => transitions.push(t));

		const now = 1_000_000;
		m.recordEvent(makeEvent("/ext/aq", { timestamp: now, success: false }));
		m.recordEvent(makeEvent("/ext/aq", { timestamp: now + 1, success: false }));
		m.recordEvent(makeEvent("/ext/aq", { timestamp: now + 2, success: false }));

		expect(transitions).toHaveLength(1);
		expect(transitions[0].type).toBe("quarantined");
		if (transitions[0].type === "quarantined") {
			expect(transitions[0].errorRate).toBe(1);
		}
	});

	// ── Listener error handling ──────────────────────────────────────────────

	it("listener errors do not propagate", () => {
		const m = new ExtensionHealthMonitor();
		m.onTransition(() => {
			throw new Error("boom");
		});
		const good: HealthTransition[] = [];
		m.onTransition((t) => good.push(t));

		m.recordEvent(makeEvent("/ext/err"));
		m.quarantine("/ext/err", "test");

		// Second listener still fires
		expect(good).toHaveLength(1);
	});
});
