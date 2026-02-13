/**
 * Token budget manager -- tracks token allocation across prompt sections
 * and provides estimation/truncation utilities.
 *
 * Uses a simple heuristic: ~4 characters per token (reasonable average
 * for English text and code). For exact counts, a proper tokenizer
 * (tiktoken) should be used, but this is fast and good enough for
 * budget planning.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface TokenBudget {
	/** Total context window size in tokens. */
	total: number;

	/** Tokens allocated for the system prompt. */
	system: number;

	/** Tokens allocated for conversation history. */
	history: number;

	/** Tokens allocated for tool definitions (part of system). */
	tools: number;

	/** Tokens reserved for the LLM response. */
	response: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Approximate characters per token (English text + code average). */
const CHARS_PER_TOKEN = 4;

/** Minimum tokens to reserve for the system prompt. */
const MIN_SYSTEM_TOKENS = 2000;

/** Minimum tokens to reserve for the response. */
const MIN_RESPONSE_TOKENS = 4096;

/** Default fraction of context for response when plenty of room. */
const RESPONSE_FRACTION = 0.2;

/** Default fraction of context for system prompt. */
const SYSTEM_FRACTION = 0.15;

/** Default fraction of context for tool definitions. */
const TOOLS_FRACTION = 0.05;

/** Truncation suffix appended when text is cut. */
const TRUNCATION_SUFFIX = "\n\n[... truncated to fit token budget]";

// ── Token estimation ─────────────────────────────────────────────────────────

/**
 * Estimate the token count for a string.
 *
 * Uses a ~4 chars/token heuristic. Returns 0 for empty strings.
 * This is intentionally simple and fast -- for exact counts,
 * use a proper tokenizer.
 */
export function estimateTokens(text: string): number {
	if (!text) return 0;
	return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// ── Token budget allocation ──────────────────────────────────────────────────

/**
 * Allocate token budget across prompt sections.
 *
 * Given a total context window and current history size, divides tokens into:
 *   - system: for the system prompt (identity, instructions, project context)
 *   - tools: for tool definitions (subset of system)
 *   - history: for conversation history
 *   - response: reserved for the LLM response
 *
 * Algorithm:
 *   1. Reserve response tokens (20% of total, min 4096)
 *   2. Reserve system tokens (15% of total, min 2000)
 *   3. Reserve tool tokens (5% of total)
 *   4. Remaining goes to history
 *   5. If history needs more, steal from system (down to MIN_SYSTEM_TOKENS)
 */
export function allocateTokenBudget(
	totalTokens: number,
	historyTokens: number,
): TokenBudget {
	// Ensure sensible minimums
	const total = Math.max(totalTokens, MIN_SYSTEM_TOKENS + MIN_RESPONSE_TOKENS);

	// Step 1: Reserve response tokens
	const response = Math.max(
		MIN_RESPONSE_TOKENS,
		Math.floor(total * RESPONSE_FRACTION),
	);

	// Step 2: Reserve tool tokens
	const tools = Math.floor(total * TOOLS_FRACTION);

	// Step 3: Calculate system budget (includes tools)
	let system = Math.max(
		MIN_SYSTEM_TOKENS,
		Math.floor(total * SYSTEM_FRACTION),
	);

	// Step 4: Remaining goes to history
	let history = total - response - system;

	// Step 5: If actual history exceeds budget, try to steal from system
	if (historyTokens > history) {
		const deficit = historyTokens - history;
		const stealable = system - MIN_SYSTEM_TOKENS;
		const steal = Math.min(deficit, Math.max(0, stealable));
		system -= steal;
		history += steal;
	}

	// Ensure nothing goes negative
	history = Math.max(0, history);

	return { total, system, history, tools, response };
}

// ── Truncation ───────────────────────────────────────────────────────────────

/**
 * Truncate text to fit within a token budget.
 *
 * If the text fits, returns it unchanged.
 * If it exceeds the budget, cuts it and appends a truncation notice.
 * Tries to cut at a line boundary for cleaner output.
 */
export function truncateToTokenBudget(text: string, maxTokens: number): string {
	if (maxTokens <= 0) return text;

	const estimated = estimateTokens(text);
	if (estimated <= maxTokens) return text;

	// Calculate max characters (leaving room for the truncation suffix)
	const suffixTokens = estimateTokens(TRUNCATION_SUFFIX);
	const availableTokens = maxTokens - suffixTokens;
	if (availableTokens <= 0) return TRUNCATION_SUFFIX.trim();

	const maxChars = availableTokens * CHARS_PER_TOKEN;

	// Cut the text
	let truncated = text.slice(0, maxChars);

	// Try to cut at a line boundary for cleaner output
	const lastNewline = truncated.lastIndexOf("\n");
	if (lastNewline > maxChars * 0.8) {
		// Only cut at newline if we keep at least 80% of the budget
		truncated = truncated.slice(0, lastNewline);
	}

	return truncated + TRUNCATION_SUFFIX;
}
