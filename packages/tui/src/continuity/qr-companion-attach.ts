/**
 * QR Companion Attach — V1 URL codec.
 *
 * Encodes / decodes a `ContinuityBootstrapPayload` into a compact URL that
 * can be rendered as a QR code and scanned by a phone/browser companion.
 *
 * Security invariants:
 * - The URL never contains raw daemon bridge tokens, provider credentials,
 *   or durable secrets.
 * - The nonce is short-lived (grant expires within 10min by default).
 * - Only the attach challenge + session binding travels in the QR.
 *
 * @see docs/local-device-continuity-protocol.md — V1 boundary
 */

import { createLogger } from "@takumi/core";
import type { ContinuityBootstrapPayload } from "./continuity-runtime.js";

const log = createLogger("qr-companion-attach");

/**
 * Default base for the attach URL.
 * In production this would point to the local HTTP bridge.
 */
const DEFAULT_ATTACH_BASE = "http://localhost:3100";

/** The URL path the companion redeems the grant at. */
const ATTACH_PATH = "/continuity/redeem";

// ── Encode ────────────────────────────────────────────────────────────────────

export interface QrAttachUrlOptions {
	/** Base URL for the HTTP bridge. Defaults to `http://localhost:3100`. */
	baseUrl?: string;
}

/**
 * Encode a bootstrap payload into a compact URL suitable for QR rendering.
 *
 * I use short single-letter query parameters to minimize QR density, which
 * matters for reliable phone-camera scanning:
 *
 * | Key | Field                |
 * |-----|----------------------|
 * | `g` | grantId              |
 * | `s` | canonicalSessionId   |
 * | `k` | kind (phone/browser) |
 * | `n` | nonce                |
 * | `e` | expiresAt (epoch)    |
 */
export function encodeAttachUrl(payload: ContinuityBootstrapPayload, opts?: QrAttachUrlOptions): string {
	const base = opts?.baseUrl ?? payload.redeemUrl ?? DEFAULT_ATTACH_BASE;
	const url = new URL(ATTACH_PATH, base);
	url.searchParams.set("g", payload.grantId);
	url.searchParams.set("s", payload.canonicalSessionId);
	url.searchParams.set("k", payload.kind);
	url.searchParams.set("n", payload.nonce);
	url.searchParams.set("e", String(payload.expiresAt));
	return url.toString();
}

// ── Decode ────────────────────────────────────────────────────────────────────

export interface DecodeAttachUrlResult {
	ok: boolean;
	payload?: ContinuityBootstrapPayload;
	error?: string;
}

/**
 * Parse a QR-scanned URL back into a `ContinuityBootstrapPayload`.
 * Returns `{ ok: false, error }` for malformed or expired URLs.
 */
export function decodeAttachUrl(rawUrl: string, now = Date.now()): DecodeAttachUrlResult {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return { ok: false, error: "Invalid URL" };
	}

	const grantId = url.searchParams.get("g");
	const canonicalSessionId = url.searchParams.get("s");
	const kind = url.searchParams.get("k");
	const nonce = url.searchParams.get("n");
	const expiresAtRaw = url.searchParams.get("e");

	if (!grantId || !canonicalSessionId || !kind || !nonce || !expiresAtRaw) {
		return { ok: false, error: "Missing required parameters" };
	}

	if (kind !== "phone" && kind !== "browser" && kind !== "runtime") {
		return { ok: false, error: `Invalid kind: ${kind}` };
	}

	const expiresAt = Number(expiresAtRaw);
	if (!Number.isFinite(expiresAt)) {
		return { ok: false, error: "Invalid expiresAt" };
	}

	if (expiresAt <= now) {
		log.warn(`QR attach grant ${grantId} expired at ${expiresAt}`);
		return { ok: false, error: "Grant expired" };
	}

	return {
		ok: true,
		payload: {
			version: 1,
			grantId,
			canonicalSessionId,
			kind,
			nonce,
			expiresAt,
			redeemUrl: url.origin + url.pathname,
		},
	};
}

// ── Terminal QR Rendering ─────────────────────────────────────────────────────

/**
 * Render a QR data string as a terminal-friendly block-character matrix.
 *
 * This is a *rendering adapter*, not a QR encoder. The caller supplies the
 * binary matrix (e.g. from a QR library). Each row is an array of booleans
 * where `true` = dark module, `false` = light module.
 *
 * I render two rows per line using Unicode half-block characters:
 * - `█` (U+2588) = both rows dark
 * - `▀` (U+2580) = top dark, bottom light
 * - `▄` (U+2584) = top light, bottom dark
 * - ` ` (space)  = both light
 *
 * This halves the vertical height of the QR code in the terminal.
 */
export function renderQrMatrix(matrix: boolean[][]): string {
	const rows = matrix.length;
	const lines: string[] = [];

	for (let y = 0; y < rows; y += 2) {
		let line = "";
		const topRow = matrix[y]!;
		const botRow = y + 1 < rows ? matrix[y + 1]! : undefined;
		const cols = topRow.length;

		for (let x = 0; x < cols; x++) {
			const top = topRow[x]!;
			const bot = botRow?.[x] ?? false;

			if (top && bot) line += "\u2588";
			else if (top && !bot) line += "\u2580";
			else if (!top && bot) line += "\u2584";
			else line += " ";
		}
		lines.push(line);
	}
	return lines.join("\n");
}
