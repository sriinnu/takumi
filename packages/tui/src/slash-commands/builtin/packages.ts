import { buildPackageDoctorReport, formatPackageDoctorReport } from "@takumi/agent";
import {
	formatPackageDetail,
	formatPackageList,
	formatPackageSummary,
	inspectTakumiPackages,
	selectTakumiPackage,
} from "../../app-package-inspector.js";
import type { AppCommandContext } from "../../commands/app-command-context.js";
import type { SlashCommandPack } from "../pack.js";

const PACKAGE_USAGE = "Usage: /packages [list|summary|doctor|show <index|name|path>]";

function getPackageCommandCompletions(ctx: AppCommandContext, partial: string): string[] {
	const trimmed = partial.trim();
	const inspection = inspectTakumiPackages(ctx.config);
	const packageNames = inspection.packages.map((pkg) => pkg.packageName);
	if (!trimmed) {
		return ["list", "summary", "doctor", ...packageNames.slice(0, 8).map((name) => `show ${name}`)];
	}
	if ("list".startsWith(trimmed)) return ["list"];
	if ("summary".startsWith(trimmed)) return ["summary"];
	if ("doctor".startsWith(trimmed)) return ["doctor"];
	if ("validate".startsWith(trimmed)) return ["validate"];
	if ("show".startsWith(trimmed)) return ["show"];
	if (trimmed.startsWith("show ")) {
		const selector = trimmed.slice(5).trim().toLowerCase();
		return packageNames
			.filter((name) => name.toLowerCase().includes(selector))
			.slice(0, 12)
			.map((name) => `show ${name}`);
	}
	return [];
}

/**
 * I expose the package inspection surface as a builtin slash-command pack so
 * it shares origin metadata and registration rules with other first-party commands.
 */
export function createPackagesSlashCommandPack(ctx: AppCommandContext): SlashCommandPack {
	return {
		id: "builtin.packages",
		label: "Packages",
		source: "builtin",
		commands: [
			{
				name: "/packages",
				description: "Inspect discovered Takumi packages",
				handler: (args) => {
					const inspection = inspectTakumiPackages(ctx.config);
					const trimmed = args.trim();
					if (!trimmed || trimmed === "list") {
						ctx.addInfoMessage(formatPackageList(inspection));
						return;
					}

					if (trimmed === "summary") {
						ctx.addInfoMessage(formatPackageSummary(inspection));
						return;
					}

					if (trimmed === "doctor" || trimmed === "validate") {
						ctx.addInfoMessage(formatPackageDoctorReport(buildPackageDoctorReport(inspection)));
						return;
					}

					if (trimmed.startsWith("show ")) {
						const selected = selectTakumiPackage(inspection, trimmed.slice(5).trim());
						if (!selected) {
							ctx.addInfoMessage(
								`Unknown package: ${trimmed.slice(5).trim() || "(empty)"}\nUse /packages to list discovered packages.`,
							);
							return;
						}
						ctx.addInfoMessage(formatPackageDetail(selected, inspection));
						return;
					}

					ctx.addInfoMessage(PACKAGE_USAGE);
				},
				getArgumentCompletions: (partial) => getPackageCommandCompletions(ctx, partial),
			},
		],
	};
}
