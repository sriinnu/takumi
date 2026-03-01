/**
 * RAG (Retrieval-Augmented Generation) context injector.
 *
 * Given a natural-language query, scores the symbol index with a
 * BM25-inspired TF-IDF scheme and returns the top-K most relevant
 * code snippets formatted for injection into the system prompt.
 *
 * No external deps. Runs in <5ms on a 50k-symbol index.
 */

import type { CodebaseIndex, IndexedSymbol } from "./indexer.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface RagResult {
	symbol: IndexedSymbol;
	score: number;
}

export interface RagOptions {
	/** Max number of results to return. Default: 10. */
	topK?: number;
	/** Minimum score threshold to include a result. Default: 0.4. */
	minScore?: number;
}

// ── Tokenizer ────────────────────────────────────────────────────────────────

const TOKEN_RE = /[A-Za-z][A-Za-z0-9_]*|[0-9]+/g;

function tokenize(text: string): string[] {
	return (text.match(TOKEN_RE) ?? []).map((t) => t.toLowerCase());
}

/**
 * Split camelCase/PascalCase/snake_case identifiers into component words.
 * e.g. "buildSystemPrompt" → ["build", "system", "prompt"]
 */
function splitIdentifier(name: string): string[] {
	return name
		.replace(/_/g, " ")
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
		.replace(/([a-z\d])([A-Z])/g, "$1 $2")
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean);
}

/** All terms associated with a symbol for scoring. */
function symbolTerms(sym: IndexedSymbol): string[] {
	return [
		...splitIdentifier(sym.name),
		sym.kind,
		...tokenize(sym.snippet),
		...sym.relPath.split(/[/\\.]/).filter((p) => p.length > 1),
	];
}

// ── BM25-lite ─────────────────────────────────────────────────────────────────

/** Compute IDF (inverse document frequency) for all terms in the index. */
function buildIdf(symbols: IndexedSymbol[]): Map<string, number> {
	const df = new Map<string, number>();
	const N = symbols.length || 1;

	for (const sym of symbols) {
		const seen = new Set(symbolTerms(sym));
		for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
	}

	const idf = new Map<string, number>();
	for (const [term, freq] of df) {
		idf.set(term, Math.log(1 + N / freq));
	}
	return idf;
}

/** BM25 (k1=1.5, b=0) score for one symbol against a set of query terms. */
function scoreSymbol(sym: IndexedSymbol, queryTerms: string[], idf: Map<string, number>): number {
	const docTerms = symbolTerms(sym);
	const tf = new Map<string, number>();
	for (const t of docTerms) tf.set(t, (tf.get(t) ?? 0) + 1);

	let score = 0;
	for (const qt of queryTerms) {
		const termTf = tf.get(qt) ?? 0;
		if (termTf === 0) continue;
		const termIdf = idf.get(qt) ?? 1;
		// BM25 with k1=1.5
		score += termIdf * ((termTf * 2.5) / (termTf + 1.5));
		// Exact name match bonus
		if (sym.name.toLowerCase() === qt) score += 3;
		else if (sym.name.toLowerCase().includes(qt)) score += 1;
		// File path relevance bonus
		if (sym.relPath.toLowerCase().includes(qt)) score += 0.5;
	}
	return score;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Score the entire index against a query and return ranked results.
 *
 * @param index  Output of `buildIndex()` or `loadIndex()`.
 * @param query  Natural-language task description or keyword phrase.
 * @param opts   Optional { topK, minScore }.
 */
export function queryIndex(index: CodebaseIndex, query: string, opts: RagOptions = {}): RagResult[] {
	const { topK = 10, minScore = 0.4 } = opts;

	// Expand query: raw tokens + identifier-spliced tokens
	const queryTerms = [...new Set([...tokenize(query), ...query.split(/\s+/).flatMap(splitIdentifier)])];

	const allSymbols = index.files.flatMap((f) => f.symbols);
	if (allSymbols.length === 0 || queryTerms.length === 0) return [];

	const idf = buildIdf(allSymbols);

	return allSymbols
		.map((sym) => ({ symbol: sym, score: scoreSymbol(sym, queryTerms, idf) }))
		.filter((r) => r.score >= minScore)
		.sort((a, b) => b.score - a.score)
		.slice(0, topK);
}

/**
 * Format RAG results as a Markdown section ready for system prompt injection.
 * Returns an empty string when there are no results.
 */
export function formatRagContext(results: RagResult[]): string {
	if (results.length === 0) return "";

	const lines: string[] = ["## Relevant codebase symbols\n"];
	let lastFile = "";

	for (const { symbol: sym } of results) {
		if (sym.relPath !== lastFile) {
			lines.push(`\n**${sym.relPath}**`);
			lastFile = sym.relPath;
		}
		lines.push(`\`\`\`\n// ${sym.kind} ${sym.name} (line ${sym.line})\n${sym.snippet}\n\`\`\``);
	}

	return lines.join("\n");
}
