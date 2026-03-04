import type { Message } from "@takumi/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Turn } from "../src/chitragupta-types.js";
import type { RecoveredSession } from "../src/session-recovery.js";
import { forkSessionAtTurn, reconstructFromDaemon } from "../src/session-recovery.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000;

function makeTurn(number: number, role: Turn["role"], text: string, timestamp = NOW): Turn {
	return { number, role, content: text, timestamp };
}

function makeMessage(id: string, role: "user" | "assistant", text: string): Message {
	return {
		id,
		role,
		content: [{ type: "text", text }],
		timestamp: NOW,
	};
}

// ── Mock bridge factory ──────────────────────────────────────────────────────

function createMockBridge(overrides: { sessionShow?: ReturnType<typeof vi.fn>; turnList?: ReturnType<typeof vi.fn> }) {
	return {
		sessionShow: overrides.sessionShow ?? vi.fn(),
		turnList: overrides.turnList ?? vi.fn(),
	} as unknown as import("../src/chitragupta.js").ChitraguptaBridge;
}

// ── Mock @takumi/core sessions module ────────────────────────────────────────

vi.mock("@takumi/core", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	// In-memory session store for fork tests
	const store = new Map<string, unknown>();

	let idCounter = 0;

	return {
		...actual,
		createLogger: () => ({
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn(),
		}),
		generateSessionId: () => {
			idCounter++;
			return `session-test-${String(idCounter).padStart(4, "0")}`;
		},
		loadSession: vi.fn(async (id: string) => {
			return (store.get(id) as null) ?? null;
		}),
		saveSession: vi.fn(async (data: { id: string }) => {
			store.set(data.id, data);
		}),
		// Expose store for test setup
		__testStore: store,
	};
});

// Import mocked functions for direct manipulation
const { loadSession, saveSession, __testStore } = (await import("@takumi/core")) as Record<string, unknown> & {
	loadSession: ReturnType<typeof vi.fn>;
	saveSession: ReturnType<typeof vi.fn>;
	__testStore: Map<string, unknown>;
};

// ── Tests: reconstructFromDaemon ─────────────────────────────────────────────

describe("reconstructFromDaemon", () => {
	it("reconstructs session from daemon turns", async () => {
		const bridge = createMockBridge({
			sessionShow: vi.fn().mockResolvedValue({
				id: "sess-abc",
				title: "Test Session",
				turns: [
					{ role: "user", content: "Hello", timestamp: NOW },
					{ role: "assistant", content: "Hi there", timestamp: NOW + 1000 },
				],
			}),
			turnList: vi.fn().mockResolvedValue([makeTurn(1, "user", "Hello"), makeTurn(2, "assistant", "Hi there")]),
		});

		const result = await reconstructFromDaemon(bridge, "sess-abc");

		expect(result).not.toBeNull();
		const recovered = result as RecoveredSession;
		expect(recovered.sessionId).toBe("sess-abc");
		expect(recovered.turnCount).toBe(2);
		expect(recovered.messages).toHaveLength(2);
		expect(recovered.messages[0].role).toBe("user");
		expect(recovered.messages[1].role).toBe("assistant");
		expect(recovered.createdAt).toBe(NOW);
		expect(recovered.updatedAt).toBe(NOW + 1000);
	});

	it("returns null when session is not found", async () => {
		const bridge = createMockBridge({
			sessionShow: vi.fn().mockResolvedValue({ id: "", title: "", turns: [] }),
			turnList: vi.fn().mockResolvedValue([]),
		});

		const result = await reconstructFromDaemon(bridge, "nonexistent");

		expect(result).toBeNull();
	});

	it("returns null when daemon is unreachable", async () => {
		const bridge = createMockBridge({
			sessionShow: vi.fn().mockRejectedValue(new Error("Connection refused")),
			turnList: vi.fn().mockRejectedValue(new Error("Connection refused")),
		});

		const result = await reconstructFromDaemon(bridge, "sess-abc");

		expect(result).toBeNull();
	});

	it("handles empty turns gracefully", async () => {
		const bridge = createMockBridge({
			sessionShow: vi.fn().mockResolvedValue({
				id: "sess-empty",
				title: "Empty Session",
				turns: [],
			}),
			turnList: vi.fn().mockResolvedValue([]),
		});

		const result = await reconstructFromDaemon(bridge, "sess-empty");

		expect(result).not.toBeNull();
		const recovered = result as RecoveredSession;
		expect(recovered.sessionId).toBe("sess-empty");
		expect(recovered.messages).toHaveLength(0);
		expect(recovered.turnCount).toBe(0);
	});
});

// ── Tests: forkSessionAtTurn ─────────────────────────────────────────────────

describe("forkSessionAtTurn", () => {
	const sourceSession = {
		id: "sess-source",
		title: "Source Session",
		createdAt: NOW,
		updatedAt: NOW + 5000,
		messages: [
			makeMessage("m1", "user", "First message"),
			makeMessage("m2", "assistant", "First reply"),
			makeMessage("m3", "user", "Second message"),
			makeMessage("m4", "assistant", "Second reply"),
			makeMessage("m5", "user", "Third message"),
		],
		model: "claude-opus-4-0-20250514",
		tokenUsage: { inputTokens: 500, outputTokens: 300, totalCost: 0.01 },
	};

	beforeEach(() => {
		__testStore.clear();
		__testStore.set("sess-source", structuredClone(sourceSession));
		vi.clearAllMocks();
	});

	it("slices messages correctly at given index", async () => {
		const newId = await forkSessionAtTurn("sess-source", 2);

		expect(newId).not.toBeNull();
		expect(newId).toMatch(/^session-test-/);

		// Verify saveSession was called with sliced messages
		expect(saveSession).toHaveBeenCalledTimes(1);
		const savedData = (saveSession as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(savedData.messages).toHaveLength(3); // indices 0, 1, 2
		expect(savedData.messages[0].content[0].text).toBe("First message");
		expect(savedData.messages[1].content[0].text).toBe("First reply");
		expect(savedData.messages[2].content[0].text).toBe("Second message");
	});

	it("returns null for missing session", async () => {
		const result = await forkSessionAtTurn("nonexistent", 0);

		expect(result).toBeNull();
	});

	it("returns null for negative turnIndex", async () => {
		const result = await forkSessionAtTurn("sess-source", -1);

		expect(result).toBeNull();
	});

	it("returns null for turnIndex beyond bounds", async () => {
		const result = await forkSessionAtTurn("sess-source", 10);

		expect(result).toBeNull();
	});

	it("generates unique session IDs", async () => {
		const id1 = await forkSessionAtTurn("sess-source", 0);
		// Re-seed the store so the source still exists
		__testStore.set("sess-source", structuredClone(sourceSession));
		const id2 = await forkSessionAtTurn("sess-source", 1);

		expect(id1).not.toBeNull();
		expect(id2).not.toBeNull();
		expect(id1).not.toBe(id2);
	});

	it("sets correct title with fork metadata", async () => {
		await forkSessionAtTurn("sess-source", 3);

		const savedData = (saveSession as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(savedData.title).toBe("Fork of Source Session @ turn 3");
	});
});
