import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Detect coding conventions from project config files. */
export function detectConventions(root: string): string | null {
	const conventions: string[] = [];

	if (existsSync(join(root, ".editorconfig"))) {
		conventions.push("Uses EditorConfig for formatting.");
	}
	if (existsSync(join(root, "biome.json")) || existsSync(join(root, "biome.jsonc"))) {
		conventions.push("Uses Biome for linting and formatting.");
	}

	const eslintFiles = [
		".eslintrc",
		".eslintrc.js",
		".eslintrc.cjs",
		".eslintrc.json",
		".eslintrc.yml",
		".eslintrc.yaml",
		"eslint.config.js",
		"eslint.config.mjs",
	];
	if (eslintFiles.some((f) => existsSync(join(root, f)))) {
		conventions.push("Uses ESLint for linting.");
	}

	const prettierFiles = [
		".prettierrc",
		".prettierrc.js",
		".prettierrc.cjs",
		".prettierrc.json",
		".prettierrc.yml",
		".prettierrc.yaml",
		"prettier.config.js",
		"prettier.config.mjs",
	];
	if (prettierFiles.some((f) => existsSync(join(root, f)))) {
		conventions.push("Uses Prettier for formatting.");
	}

	const tsconfigPath = join(root, "tsconfig.json");
	if (existsSync(tsconfigPath)) {
		try {
			const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf-8"));
			if (tsconfig.compilerOptions?.strict) {
				conventions.push("TypeScript strict mode enabled.");
			}
		} catch {
			/* ignore */
		}
	}

	if (
		existsSync(join(root, "pnpm-workspace.yaml")) ||
		existsSync(join(root, "lerna.json")) ||
		existsSync(join(root, "nx.json"))
	) {
		conventions.push("Monorepo project structure.");
	}

	return conventions.length > 0 ? conventions.join("\n") : null;
}
