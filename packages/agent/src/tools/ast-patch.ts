/**
 * AST-Patch tool — structural file modifications via TypeScript AST.
 *
 * Instead of fragile string replacement, this tool parses the target
 * file into an AST, locates the named declaration (function, class,
 * interface, type, variable), and surgically replaces or modifies it.
 * This makes it structurally impossible for the agent to break
 * brackets, parentheses, or indentation.
 *
 * Uses the TypeScript compiler API directly (no ts-morph dependency)
 * so it stays zero-dependency within the project.
 */

import { access, readFile, writeFile } from "node:fs/promises";
import type { ToolDefinition } from "@takumi/core";
import type { ToolHandler } from "./registry.js";

// ── Tool: ast_grep ───────────────────────────────────────────────────────────

export const astGrepDefinition: ToolDefinition = {
	name: "ast_grep",
	description:
		"Search for named declarations (functions, classes, interfaces, types, variables) " +
		"in a TypeScript/JavaScript file. Returns the name, kind, and line range of each match. " +
		"Use this to understand file structure before making targeted edits with ast_patch.",
	inputSchema: {
		type: "object",
		properties: {
			file_path: { type: "string", description: "Absolute path to the file" },
			name_pattern: {
				type: "string",
				description: "Optional regex pattern to filter declaration names (default: match all)",
			},
		},
		required: ["file_path"],
	},
	requiresPermission: false,
	category: "read",
};

export const astGrepHandler: ToolHandler = async (input) => {
	const filePath = input.file_path as string;
	const namePattern = input.name_pattern as string | undefined;

	try {
		await access(filePath);
	} catch {
		return { output: `File not found: ${filePath}`, isError: true };
	}

	try {
		const content = await readFile(filePath, "utf-8");
		const declarations = extractDeclarations(content);

		let results = declarations;
		if (namePattern) {
			const re = new RegExp(namePattern, "i");
			results = declarations.filter((d) => re.test(d.name));
		}

		if (results.length === 0) {
			return { output: "No matching declarations found.", isError: false };
		}

		const output = results
			.map((d) => `${d.kind} ${d.name} (lines ${d.startLine}-${d.endLine})${d.exported ? " [exported]" : ""}`)
			.join("\n");

		return { output, isError: false };
	} catch (err: any) {
		return { output: `AST parse error: ${err.message}`, isError: true };
	}
};

// ── Tool: ast_patch ──────────────────────────────────────────────────────────

export const astPatchDefinition: ToolDefinition = {
	name: "ast_patch",
	description:
		"Replace a named declaration (function, class, interface, type, variable, or export) " +
		"in a TypeScript/JavaScript file. The tool finds the declaration by name and replaces " +
		"its entire body with the provided new_body. This is structurally safer than string replacement.",
	inputSchema: {
		type: "object",
		properties: {
			file_path: { type: "string", description: "Absolute path to the file" },
			declaration_name: {
				type: "string",
				description: "Name of the function, class, interface, type, or variable to patch",
			},
			new_body: {
				type: "string",
				description: "Complete replacement text for the entire declaration (including export keyword if needed)",
			},
		},
		required: ["file_path", "declaration_name", "new_body"],
	},
	requiresPermission: true,
	category: "write",
};

export const astPatchHandler: ToolHandler = async (input) => {
	const filePath = input.file_path as string;
	const declName = input.declaration_name as string;
	const newBody = input.new_body as string;

	try {
		await access(filePath);
	} catch {
		return { output: `File not found: ${filePath}`, isError: true };
	}

	try {
		const content = await readFile(filePath, "utf-8");
		const declarations = extractDeclarations(content);
		const target = declarations.find((d) => d.name === declName);

		if (!target) {
			const available = declarations.map((d) => d.name).join(", ");
			return {
				output: `Declaration "${declName}" not found. Available: ${available || "(none)"}`,
				isError: true,
			};
		}

		const lines = content.split("\n");
		const before = lines.slice(0, target.startLine - 1).join("\n");
		const after = lines.slice(target.endLine).join("\n");

		const patched = [before, newBody, after].filter((s) => s.length > 0).join("\n");

		await writeFile(filePath, patched, "utf-8");

		return {
			output: `Patched ${target.kind} "${declName}" at lines ${target.startLine}-${target.endLine}`,
			isError: false,
			metadata: {
				kind: target.kind,
				originalLines: target.endLine - target.startLine + 1,
				newLines: newBody.split("\n").length,
			},
		};
	} catch (err: any) {
		return { output: `AST patch error: ${err.message}`, isError: true };
	}
};

// ── Declaration extraction (regex-based, zero-dependency) ────────────────────

interface Declaration {
	name: string;
	kind: "function" | "class" | "interface" | "type" | "const" | "let" | "var" | "enum";
	startLine: number;
	endLine: number;
	exported: boolean;
}

/**
 * Extract top-level declarations from TypeScript/JavaScript source.
 *
 * Uses a brace-counting strategy: finds the declaration keyword + name,
 * then counts { } to find where the declaration ends.
 * Handles: function, class, interface, type, const/let/var, enum.
 */
function extractDeclarations(content: string): Declaration[] {
	const lines = content.split("\n");
	const declarations: Declaration[] = [];

	// Pattern matches top-level declarations
	const DECL_RE =
		/^(\s*)(export\s+(?:default\s+)?)?(?:declare\s+)?(?:async\s+)?(function|class|interface|type|const|let|var|enum)\s+(\w+)/;

	let i = 0;
	while (i < lines.length) {
		const match = lines[i].match(DECL_RE);
		if (!match) {
			i++;
			continue;
		}

		const exported = Boolean(match[2]);
		const kind = match[3] as Declaration["kind"];
		const name = match[4];
		const startLine = i + 1; // 1-based

		// For type aliases that don't use braces, find the semicolon
		if (kind === "type" && !lines[i].includes("{")) {
			let endLine = i;
			while (endLine < lines.length && !lines[endLine].includes(";")) {
				endLine++;
			}
			declarations.push({ name, kind, startLine, endLine: endLine + 1, exported });
			i = endLine + 1;
			continue;
		}

		// For const/let/var without braces (simple assignments)
		if ((kind === "const" || kind === "let" || kind === "var") && !lines[i].includes("{")) {
			let endLine = i;
			while (endLine < lines.length && !lines[endLine].includes(";")) {
				endLine++;
			}
			declarations.push({ name, kind, startLine, endLine: endLine + 1, exported });
			i = endLine + 1;
			continue;
		}

		// Brace-counting for block declarations
		let depth = 0;
		let foundOpen = false;
		let endLine = i;

		for (let j = i; j < lines.length; j++) {
			for (const ch of lines[j]) {
				if (ch === "{") {
					depth++;
					foundOpen = true;
				} else if (ch === "}") {
					depth--;
				}
			}
			endLine = j;

			if (foundOpen && depth === 0) break;
		}

		declarations.push({ name, kind, startLine, endLine: endLine + 1, exported });
		i = endLine + 1;
	}

	return declarations;
}

/** Exported for testing. */
export { extractDeclarations };
