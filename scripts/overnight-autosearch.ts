import { pathToFileURL } from "node:url";
import {
	buildFocusPlan,
	buildResearchPrompt,
	buildSynthesisPrompt,
	extractFindingHeadlines,
	parseCliOptions,
	resolveResearchPaths,
	type OvernightAutosearchOptions,
	type ResearchIterationResult,
	type ResearchPaths,
} from "../bin/cli/overnight-autosearch-shared.js";
import { runOvernightAutosearch } from "./overnight-autosearch-runner.js";

export {
	buildFocusPlan,
	buildResearchPrompt,
	buildSynthesisPrompt,
	extractFindingHeadlines,
	parseCliOptions,
	resolveResearchPaths,
	type OvernightAutosearchOptions,
	type ResearchIterationResult,
	type ResearchPaths,
};
export { runOvernightAutosearch } from "./overnight-autosearch-runner.js";

async function main(): Promise<void> {
	const options = parseCliOptions(process.argv.slice(2));
	const paths = await runOvernightAutosearch(options);
	process.stdout.write(`Overnight autosearch report: ${paths.reportFile}\n`);
	process.stdout.write(`Raw iteration log: ${paths.rawLogFile}\n`);
}

const entryArg = process.argv[1];
if (entryArg && import.meta.url === pathToFileURL(entryArg).href) {
	main().catch((error) => {
		const message = error instanceof Error ? error.stack ?? error.message : String(error);
		process.stderr.write(`${message}\n`);
		process.exit(1);
	});
}
