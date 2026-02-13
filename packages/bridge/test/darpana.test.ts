import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock fetch globally ──────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Mock child_process (for stop / auto-launch tests) ────────────────────────

vi.mock("node:child_process", () => ({
	spawn: vi.fn(() => {
		const { EventEmitter } = require("node:events");
		const proc = new EventEmitter();
		proc.kill = vi.fn();
		proc.pid = 99999;
		proc.unref = vi.fn();
		proc.stderr = new (require("node:stream").Readable)({ read() {} });
		return proc;
	}),
}));

import { DarpanaClient, type DarpanaConfig } from "@takumi/bridge";

// ── Helpers ──────────────────────────────────────────────────────────────────

function okResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function failResponse(status = 500) {
	return new Response("Internal Server Error", { status });
}

function networkError() {
	return Promise.reject(new TypeError("fetch failed"));
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("DarpanaClient", () => {
	let client: DarpanaClient;

	const defaultConfig: DarpanaConfig = {
		url: "http://localhost:3141",
	};

	beforeEach(() => {
		mockFetch.mockReset();
		client = new DarpanaClient(defaultConfig);
	});

	afterEach(() => {
		client.stop();
	});

	// ── healthCheck ──────────────────────────────────────────────────────

	describe("healthCheck()", () => {
		it("returns true when /health responds with ok status", async () => {
			mockFetch.mockResolvedValueOnce(okResponse({ status: "ok" }));
			const result = await client.healthCheck();
			expect(result).toBe(true);
			expect(mockFetch).toHaveBeenCalledWith(
				"http://localhost:3141/health",
				expect.objectContaining({ method: "GET" }),
			);
		});

		it("returns false on network error", async () => {
			mockFetch.mockImplementationOnce(() => networkError());
			const result = await client.healthCheck();
			expect(result).toBe(false);
		});

		it("returns false on non-ok response", async () => {
			mockFetch.mockResolvedValueOnce(failResponse(503));
			const result = await client.healthCheck();
			expect(result).toBe(false);
		});
	});

	// ── healthy getter ───────────────────────────────────────────────────

	describe("healthy getter", () => {
		it("defaults to false before any health check", () => {
			expect(client.healthy).toBe(false);
		});

		it("reflects true after a successful health check", async () => {
			mockFetch.mockResolvedValueOnce(okResponse({ status: "ok" }));
			await client.healthCheck();
			expect(client.healthy).toBe(true);
		});

		it("reflects false after a failed health check", async () => {
			// First succeed
			mockFetch.mockResolvedValueOnce(okResponse({ status: "ok" }));
			await client.healthCheck();
			expect(client.healthy).toBe(true);

			// Then fail
			mockFetch.mockImplementationOnce(() => networkError());
			await client.healthCheck();
			expect(client.healthy).toBe(false);
		});
	});

	// ── url getter ───────────────────────────────────────────────────────

	describe("url getter", () => {
		it("returns the configured URL", () => {
			expect(client.url).toBe("http://localhost:3141");
		});

		it("returns custom URL when configured", () => {
			const custom = new DarpanaClient({ url: "http://localhost:9999" });
			expect(custom.url).toBe("http://localhost:9999");
		});
	});

	// ── listModels ───────────────────────────────────────────────────────

	describe("listModels()", () => {
		it("returns models from response", async () => {
			const models = [
				{ id: "claude-sonnet-4-20250514", provider: "anthropic" },
				{ id: "gpt-4o", provider: "openai" },
			];
			mockFetch.mockResolvedValueOnce(okResponse({ models }));

			const result = await client.listModels();
			expect(result).toEqual(models);
			expect(mockFetch).toHaveBeenCalledWith(
				"http://localhost:3141/v1/models",
				expect.objectContaining({}),
			);
		});

		it("returns empty array on network error", async () => {
			mockFetch.mockImplementationOnce(() => networkError());
			const result = await client.listModels();
			expect(result).toEqual([]);
		});

		it("returns empty array on non-ok response", async () => {
			mockFetch.mockResolvedValueOnce(failResponse(500));
			const result = await client.listModels();
			expect(result).toEqual([]);
		});

		it("returns empty array when response has no models property", async () => {
			mockFetch.mockResolvedValueOnce(okResponse({}));
			const result = await client.listModels();
			expect(result).toEqual([]);
		});
	});

	// ── ensureRunning ────────────────────────────────────────────────────

	describe("ensureRunning()", () => {
		it("returns true if already healthy", async () => {
			mockFetch.mockResolvedValueOnce(okResponse({ status: "ok" }));
			const result = await client.ensureRunning();
			expect(result).toBe(true);
		});

		it("returns false when not healthy and no auto-launch", async () => {
			mockFetch.mockImplementationOnce(() => networkError());
			const result = await client.ensureRunning();
			expect(result).toBe(false);
		});

		it("returns false when not healthy and autoLaunch is false", async () => {
			const noAutoClient = new DarpanaClient({
				url: "http://localhost:3141",
				autoLaunch: false,
				binaryPath: "/usr/local/bin/darpana",
			});
			mockFetch.mockImplementationOnce(() => networkError());
			const result = await noAutoClient.ensureRunning();
			expect(result).toBe(false);
		});
	});

	// ── stop ─────────────────────────────────────────────────────────────

	describe("stop()", () => {
		it("is safe to call when no child process exists", () => {
			// No auto-launch was performed, so no child process
			expect(() => client.stop()).not.toThrow();
		});

		it("is safe to call multiple times", () => {
			expect(() => {
				client.stop();
				client.stop();
			}).not.toThrow();
		});
	});

	// ── Constructor defaults ─────────────────────────────────────────────

	describe("constructor defaults", () => {
		it("defaults port to 3141", () => {
			const c = new DarpanaClient({ url: "http://localhost:3141" });
			// We can't read private config directly, but url should be set
			expect(c.url).toBe("http://localhost:3141");
		});

		it("defaults autoLaunch to false", async () => {
			// If autoLaunch were true, ensureRunning would try to launch.
			// Since it's false by default, ensureRunning should just return false
			// when the health check fails.
			const c = new DarpanaClient({
				url: "http://localhost:3141",
				binaryPath: "/usr/local/bin/darpana",
			});
			mockFetch.mockImplementationOnce(() => networkError());
			const result = await c.ensureRunning();
			expect(result).toBe(false);
		});
	});
});
