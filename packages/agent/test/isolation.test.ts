import { cp, mkdtemp, rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...actual,
		cp: vi.fn(async () => undefined),
		mkdtemp: vi.fn(async () => "/tmp/takumi-isolation"),
		rm: vi.fn(async () => undefined),
	};
});

vi.mock("@takumi/bridge", () => ({
	gitRoot: vi.fn((cwd: string) => (cwd.startsWith("/repo") ? "/repo" : null)),
	gitWorktreeAdd: vi.fn((_root: string, path: string) => path),
	gitWorktreeRemove: vi.fn(() => true),
	isGitRepo: vi.fn((root: string) => root === "/repo"),
}));

vi.mock("@takumi/core", () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	}),
}));

import { gitWorktreeAdd, gitWorktreeRemove } from "@takumi/bridge";
import { createIsolationContext } from "../src/cluster/isolation.js";

const originalEnv = { ...process.env };

describe("createIsolationContext", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(mkdtemp).mockResolvedValue("/tmp/takumi-isolation");
	});

	afterEach(() => {
		for (const key of Object.keys(process.env)) {
			if (!(key in originalEnv)) delete process.env[key];
		}
		Object.assign(process.env, originalEnv);
		vi.restoreAllMocks();
	});

	it("preserves the nested source directory for worktree isolation", async () => {
		const ctx = await createIsolationContext("worktree", "/repo/packages/agent", "cluster-abc123");

		expect(ctx.mode).toBe("worktree");
		expect(ctx.workDir).toBe("/tmp/takumi-isolation/packages/agent");
		expect(gitWorktreeAdd).toHaveBeenCalledWith("/repo", "/tmp/takumi-isolation");

		await ctx.cleanup();
		expect(gitWorktreeRemove).toHaveBeenCalledWith("/repo", "/tmp/takumi-isolation");
		expect(rm).toHaveBeenCalledWith("/tmp/takumi-isolation", { recursive: true, force: true });
	});

	it("falls back to none when worktree isolation is unavailable", async () => {
		const ctx = await createIsolationContext("worktree", "/plain/project", "cluster-plain");

		expect(ctx.mode).toBe("none");
		expect(ctx.workDir).toBe("/plain/project");
		expect(gitWorktreeAdd).not.toHaveBeenCalled();
	});

	it("stages git-backed docker isolation from the repo root and preserves nested workDir", async () => {
		process.env.AWS_PROFILE = "dev-profile";
		process.env.AWS_REGION = "us-west-2";
		process.env.NODE_ENV = "test";

		const ctx = await createIsolationContext("docker", "/repo/packages/agent", "cluster-docker", {
			image: "node:22-alpine",
			mounts: ["git"],
			envPassthrough: ["AWS_*", "GITHUB_TOKEN"],
		});

		expect(ctx.mode).toBe("docker");
		expect(ctx.workDir).toBe("/tmp/takumi-isolation/workspace/packages/agent");
		expect(gitWorktreeAdd).toHaveBeenCalledWith("/repo", "/tmp/takumi-isolation/workspace");
		expect(cp).not.toHaveBeenCalled();
		expect(ctx.dockerConfig).toMatchObject({
			hostWorkDir: "/tmp/takumi-isolation/workspace",
			containerWorkDir: "/workspace/packages/agent",
			envArgs: expect.arrayContaining(["-e AWS_PROFILE", "-e AWS_REGION"]),
		});
		expect(ctx.dockerConfig?.envArgs).not.toContain("-e NODE_ENV");

		await ctx.cleanup();
		expect(gitWorktreeRemove).toHaveBeenCalledWith("/repo", "/tmp/takumi-isolation/workspace");
		expect(rm).toHaveBeenCalledWith("/tmp/takumi-isolation", { recursive: true, force: true });
	});

	it("copies non-git projects for docker isolation", async () => {
		const ctx = await createIsolationContext("docker", "/plain/project", "cluster-copy", {
			image: "node:22-alpine",
			mounts: [],
			envPassthrough: [],
		});

		expect(ctx.mode).toBe("docker");
		expect(ctx.workDir).toBe("/tmp/takumi-isolation/workspace");
		expect(cp).toHaveBeenCalledWith("/plain/project", "/tmp/takumi-isolation/workspace", { recursive: true });
		expect(gitWorktreeAdd).not.toHaveBeenCalled();
	});
});
