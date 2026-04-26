/**
 * File encoding detection and roundtrip utilities.
 *
 * I detect line-ending style (LF / CRLF / mixed) and UTF-8 BOM on read,
 * normalize content for editing, then restore the original encoding on write.
 * This prevents silent mutation of line endings or BOM when tools edit files.
 *
 * @module file-encoding
 */

import { readFile, writeFile } from "node:fs/promises";

/** Detected line-ending style. */
export type LineEnding = "lf" | "crlf" | "mixed";

/** Detected BOM presence. */
export type Bom = "utf8-bom" | "none";

/** Encoding metadata captured on read, fed back on write. */
export interface FileEncoding {
	lineEnding: LineEnding;
	bom: Bom;
}

/** Result of reading a file with encoding detection. */
export interface EncodedFileResult extends FileEncoding {
	/** File content normalized to LF with BOM stripped — ready for editing. */
	content: string;
}

// ── Detection ────────────────────────────────────────────────────────

/** I count CRLF vs bare-LF occurrences and return the dominant style. */
export function detectLineEnding(content: string): LineEnding {
	const crlf = (content.match(/\r\n/g) ?? []).length;
	// Bare LF = \n not preceded by \r
	const lf = (content.match(/(?<!\r)\n/g) ?? []).length;
	if (crlf > 0 && lf > 0) return "mixed";
	if (crlf > 0) return "crlf";
	return "lf";
}

/** I check the first three bytes for the UTF-8 BOM signature (EF BB BF). */
export function detectBom(buffer: Buffer): Bom {
	if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
		return "utf8-bom";
	}
	return "none";
}

// ── Strip / Restore ──────────────────────────────────────────────────

/** I remove the BOM character U+FEFF from the start of a string if present. */
export function stripBom(content: string): string {
	return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

/** I prepend the BOM character when the original file had one. */
export function restoreBom(content: string, bom: Bom): string {
	return bom === "utf8-bom" ? `\uFEFF${content}` : content;
}

/** I normalize all line endings to LF so editing logic can work uniformly. */
export function normalizeLineEndings(content: string): string {
	return content.replace(/\r\n/g, "\n");
}

/**
 * I restore line endings to whatever the file originally used.
 * - `lf`    → no-op (already LF after normalize)
 * - `crlf`  → convert every LF to CRLF
 * - `mixed` → no-op (preserve the caller's content as-is)
 */
export function restoreLineEndings(content: string, lineEnding: LineEnding): string {
	if (lineEnding === "crlf") return content.replace(/\n/g, "\r\n");
	return content;
}

// ── Binary detection ─────────────────────────────────────────────────

/** I check the first 8 KB of a buffer for null bytes — a reliable binary indicator. */
export function isBinaryFile(buffer: Buffer): boolean {
	const check = Math.min(buffer.length, 8192);
	for (let i = 0; i < check; i++) {
		if (buffer[i] === 0x00) return true;
	}
	return false;
}

// ── High-level read / write ──────────────────────────────────────────

/**
 * I read a file, detect its BOM and line-ending style, then return
 * normalized content (LF, no BOM) alongside the encoding metadata
 * so the caller can roundtrip edits without mutating whitespace.
 */
export async function readFileWithEncoding(filePath: string): Promise<EncodedFileResult> {
	const buffer = await readFile(filePath);
	if (isBinaryFile(buffer)) {
		throw new Error(`Binary file detected: ${filePath} — cannot safely edit binary files`);
	}
	const bom = detectBom(buffer);
	const raw = buffer.toString("utf-8");
	const lineEnding = detectLineEnding(raw);
	const content = normalizeLineEndings(stripBom(raw));
	return { content, lineEnding, bom };
}

/**
 * I write content back to disk, restoring the original line endings
 * and BOM so the file's encoding stays exactly as it was before the edit.
 */
export async function writeFileWithEncoding(filePath: string, content: string, encoding: FileEncoding): Promise<void> {
	const restored = restoreBom(restoreLineEndings(content, encoding.lineEnding), encoding.bom);
	await writeFile(filePath, restored, "utf-8");
}
