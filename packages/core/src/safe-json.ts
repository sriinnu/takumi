// ── Safe JSON parsing with size guards ────────────────────────────────────────
// I cap payload size before hitting JSON.parse to prevent OOM crashes from
// unbounded responses (the Chitragupta 512 MB heap incident).

/** 1 MB — SSE data lines. */
export const JSON_MAX_SSE_CHUNK = 1 * 1024 * 1024;
/** 10 MB — config / session files. */
export const JSON_MAX_FILE = 10 * 1024 * 1024;
/** 50 MB — daemon IPC responses. */
export const JSON_MAX_DAEMON = 50 * 1024 * 1024;
/** 100 MB — cluster checkpoints. */
export const JSON_MAX_CHECKPOINT = 100 * 1024 * 1024;

const DEFAULT_MAX = JSON_MAX_FILE;

/** Keys that can trigger prototype pollution if spread or assigned into an object. */
const POISON_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** JSON reviver that strips prototype-polluting keys. */
const safeReviver = (key: string, value: unknown): unknown => (POISON_KEYS.has(key) ? undefined : value);

/**
 * I parse JSON after checking that `raw` doesn't exceed `maxLength` characters.
 * Prototype-polluting keys (__proto__, constructor, prototype) are stripped.
 * Throws a `RangeError` if the payload is too large, or a `SyntaxError` if the JSON is invalid.
 *
 * @param raw - The JSON string to parse.
 * @param maxLength - Character-length ceiling (defaults to 10 MB worth of chars).
 */
export function safeJsonParse<T>(raw: string, maxLength: number = DEFAULT_MAX): T {
	if (raw.length > maxLength) {
		throw new RangeError(`JSON payload too large: ${raw.length} chars exceeds limit of ${maxLength}`);
	}
	return JSON.parse(raw, safeReviver) as T;
}

/**
 * I parse JSON with the same size guard as {@link safeJsonParse}, but return
 * `null` instead of throwing on any failure (size exceeded or invalid JSON).
 *
 * @param raw - The JSON string to parse.
 * @param maxLength - Character-length ceiling (defaults to 10 MB worth of chars).
 */
export function safeJsonParseOrNull<T>(raw: string, maxLength: number = DEFAULT_MAX): T | null {
	try {
		return safeJsonParse<T>(raw, maxLength);
	} catch {
		return null;
	}
}
