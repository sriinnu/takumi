import { describe, expect, it } from "vitest";
import type { ContinuityBootstrapPayload } from "../src/continuity/continuity-runtime.js";
import { decodeAttachUrl, encodeAttachUrl, renderQrMatrix } from "../src/continuity/qr-companion-attach.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePayload(overrides: Partial<ContinuityBootstrapPayload> = {}): ContinuityBootstrapPayload {
	return {
		version: 1,
		grantId: "grant-abc",
		canonicalSessionId: "sess-123",
		kind: "phone",
		nonce: "nonce-xyz",
		expiresAt: Date.now() + 600_000,
		redeemUrl: null,
		...overrides,
	};
}

// ── Encode / Decode Round-Trip ────────────────────────────────────────────────

describe("encodeAttachUrl", () => {
	it("produces a valid URL with compact query params", () => {
		const url = encodeAttachUrl(makePayload());
		expect(url).toContain("/continuity/redeem");
		expect(url).toContain("g=grant-abc");
		expect(url).toContain("s=sess-123");
		expect(url).toContain("k=phone");
		expect(url).toContain("n=nonce-xyz");
		expect(url).toContain("e=");
	});

	it("uses custom baseUrl when provided", () => {
		const url = encodeAttachUrl(makePayload(), { baseUrl: "http://10.0.0.5:4000" });
		expect(url.startsWith("http://10.0.0.5:4000")).toBe(true);
	});

	it("falls back to redeemUrl from payload", () => {
		const url = encodeAttachUrl(makePayload({ redeemUrl: "http://192.168.1.10:3100" }));
		expect(url.startsWith("http://192.168.1.10:3100")).toBe(true);
	});

	it("defaults to localhost:3100 when no base or redeemUrl", () => {
		const url = encodeAttachUrl(makePayload());
		expect(url.startsWith("http://localhost:3100")).toBe(true);
	});
});

describe("decodeAttachUrl", () => {
	it("round-trips a valid payload", () => {
		const original = makePayload();
		const url = encodeAttachUrl(original);
		const result = decodeAttachUrl(url);
		expect(result.ok).toBe(true);
		expect(result.payload!.grantId).toBe(original.grantId);
		expect(result.payload!.canonicalSessionId).toBe(original.canonicalSessionId);
		expect(result.payload!.kind).toBe(original.kind);
		expect(result.payload!.nonce).toBe(original.nonce);
		expect(result.payload!.expiresAt).toBe(original.expiresAt);
	});

	it("rejects invalid URLs", () => {
		const result = decodeAttachUrl("not-a-url");
		expect(result.ok).toBe(false);
		expect(result.error).toBe("Invalid URL");
	});

	it("rejects URLs with missing parameters", () => {
		const result = decodeAttachUrl("http://localhost:3100/continuity/redeem?g=abc");
		expect(result.ok).toBe(false);
		expect(result.error).toBe("Missing required parameters");
	});

	it("rejects expired grants", () => {
		const past = Date.now() - 10_000;
		const url = encodeAttachUrl(makePayload({ expiresAt: past }));
		const result = decodeAttachUrl(url);
		expect(result.ok).toBe(false);
		expect(result.error).toBe("Grant expired");
	});

	it("rejects invalid kind values", () => {
		const url = "http://localhost:3100/continuity/redeem?g=a&s=b&k=invalid&n=c&e=99999999999999";
		const result = decodeAttachUrl(url);
		expect(result.ok).toBe(false);
		expect(result.error).toContain("Invalid kind");
	});

	it("rejects non-numeric expiresAt", () => {
		const url = "http://localhost:3100/continuity/redeem?g=a&s=b&k=phone&n=c&e=abc";
		const result = decodeAttachUrl(url);
		expect(result.ok).toBe(false);
		expect(result.error).toBe("Invalid expiresAt");
	});

	it("populates redeemUrl from the parsed URL origin + path", () => {
		const original = makePayload();
		const url = encodeAttachUrl(original, { baseUrl: "http://10.0.0.5:4000" });
		const result = decodeAttachUrl(url);
		expect(result.ok).toBe(true);
		expect(result.payload!.redeemUrl).toBe("http://10.0.0.5:4000/continuity/redeem");
	});
});

// ── Terminal QR Rendering ─────────────────────────────────────────────────────

describe("renderQrMatrix", () => {
	it("renders a 2x2 all-dark matrix as a single full block", () => {
		const matrix = [
			[true, true],
			[true, true],
		];
		const output = renderQrMatrix(matrix);
		expect(output).toBe("\u2588\u2588");
	});

	it("renders top-dark, bottom-light as upper half blocks", () => {
		const matrix = [
			[true, true],
			[false, false],
		];
		const output = renderQrMatrix(matrix);
		expect(output).toBe("\u2580\u2580");
	});

	it("renders top-light, bottom-dark as lower half blocks", () => {
		const matrix = [
			[false, false],
			[true, true],
		];
		const output = renderQrMatrix(matrix);
		expect(output).toBe("\u2584\u2584");
	});

	it("renders all-light as spaces", () => {
		const matrix = [
			[false, false],
			[false, false],
		];
		expect(renderQrMatrix(matrix)).toBe("  ");
	});

	it("handles odd row count (last row has no bottom pair)", () => {
		const matrix = [
			[true, false],
			[false, true],
			[true, true],
		];
		const output = renderQrMatrix(matrix);
		const lines = output.split("\n");
		expect(lines).toHaveLength(2);
		// Row pair 0-1: top=T/F, bot=F/T → ▀/▄
		expect(lines[0]).toBe("\u2580\u2584");
		// Row 2 alone: top=T/T, bot=F/F → ▀▀
		expect(lines[1]).toBe("\u2580\u2580");
	});

	it("handles empty matrix", () => {
		expect(renderQrMatrix([])).toBe("");
	});
});
