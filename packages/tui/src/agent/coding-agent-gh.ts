import { spawn } from "node:child_process";

/** Create and optionally auto-merge a PR via GitHub CLI. */
export async function createPullRequestViaGh(
	description: string,
	autoMerge: boolean,
	addSystemMessage: (text: string) => void,
): Promise<void> {
	const run = (args: string[]): Promise<{ code: number; out: string; err: string }> =>
		new Promise((resolve) => {
			const child = spawn("gh", args, { stdio: ["ignore", "pipe", "pipe"] });
			let out = "";
			let err = "";
			child.stdout.on("data", (d: Buffer) => {
				out += d.toString();
			});
			child.stderr.on("data", (d: Buffer) => {
				err += d.toString();
			});
			child.on("close", (code: number) => resolve({ code, out, err }));
		});

	addSystemMessage("Creating pull request via gh CLI…");
	const createRes = await run(["pr", "create", "--fill", "--body", `Created by Takumi: ${description}`]);
	if (createRes.code !== 0) {
		addSystemMessage(`[--pr] Could not create PR: ${createRes.err.trim().split("\n")[0]}`);
		return;
	}

	const prUrl = createRes.out.trim();
	addSystemMessage(`[--pr] PR created: ${prUrl}`);
	if (!autoMerge) return;

	const mergeRes = await run(["pr", "merge", prUrl, "--auto", "--squash"]);
	if (mergeRes.code !== 0) {
		addSystemMessage(`[--ship] Auto-merge failed: ${mergeRes.err.trim().split("\n")[0]}`);
		return;
	}
	addSystemMessage(`[--ship] PR merged: ${prUrl}`);
}
