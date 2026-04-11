import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const sourceDirs = [
	path.join(repoRoot, "agents", "orchestration"),
	path.join(repoRoot, "agents", "specialists"),
];
const targetDir = path.join(repoRoot, ".github", "agents");

async function ensureDir(dir) {
	await fs.mkdir(dir, { recursive: true });
}

async function readAgentSources() {
	const files = [];
	for (const dir of sourceDirs) {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.endsWith(".agent.md")) {
				continue;
			}
			files.push(path.join(dir, entry.name));
		}
	}
	files.sort();
	return files;
}

async function syncAgentFile(sourceFile) {
	const name = path.basename(sourceFile);
	const targetFile = path.join(targetDir, name);
	const content = await fs.readFile(sourceFile, "utf8");
	const existing = await fs.readFile(targetFile, "utf8").catch(() => null);
	if (existing === content) {
		return { name, changed: false };
	}
	await fs.writeFile(targetFile, content, "utf8");
	return { name, changed: true };
}

async function removeStaleMirrors(sourceFiles) {
	const allowed = new Set(sourceFiles.map((file) => path.basename(file)));
	const entries = await fs.readdir(targetDir, { withFileTypes: true });
	const removed = [];
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".agent.md")) {
			continue;
		}
		if (allowed.has(entry.name)) {
			continue;
		}
		await fs.rm(path.join(targetDir, entry.name));
		removed.push(entry.name);
	}
	removed.sort();
	return removed;
}

async function main() {
	await ensureDir(targetDir);
	const sourceFiles = await readAgentSources();
	if (sourceFiles.length === 0) {
		throw new Error("No canonical agent sources found under agents/");
	}

	const results = [];
	for (const sourceFile of sourceFiles) {
		results.push(await syncAgentFile(sourceFile));
	}

	const removed = await removeStaleMirrors(sourceFiles);
	const changedCount = results.filter((result) => result.changed).length;

	console.log(
		`Synced ${sourceFiles.length} custom agent definition(s) to ${path.relative(repoRoot, targetDir)} ` +
			`(${changedCount} updated, ${removed.length} removed).`,
	);

	if (removed.length > 0) {
		console.log(`Removed stale mirrors: ${removed.join(", ")}`);
	}
	if (changedCount > 0) {
		console.log(
			`Updated mirrors: ${results
				.filter((result) => result.changed)
				.map((result) => result.name)
				.join(", ")}`,
		);
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});