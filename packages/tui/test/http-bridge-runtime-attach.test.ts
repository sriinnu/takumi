import { describe, expect, it, vi } from "vitest";
import { attachDesktopBridgeSession } from "../src/http-bridge/http-bridge-runtime.js";
import { AppState } from "../src/state.js";

describe("attachDesktopBridgeSession", () => {
	it("delegates to the runtime attach callback when one is available", async () => {
		const attachSession = vi.fn(async (sessionId: string) => ({
			success: true,
			error: sessionId === "never" ? "boom" : undefined,
		}));

		const result = await attachDesktopBridgeSession(new AppState(), "session-42", attachSession);

		expect(result).toEqual({ success: true, error: undefined });
		expect(attachSession).toHaveBeenCalledWith("session-42");
	});

	it("turns callback exceptions into bridge-friendly attach failures", async () => {
		const result = await attachDesktopBridgeSession(new AppState(), "session-99", async () => {
			throw new Error("nope");
		});

		expect(result).toEqual({ success: false, error: "nope" });
	});
});
