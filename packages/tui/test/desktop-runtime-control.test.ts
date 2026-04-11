import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock, openSyncMock, osMockState } = vi.hoisted(() => ({
	spawnMock: vi.fn(),
	openSyncMock: vi.fn(() => 11),
	osMockState: { home: "" },
}));

vi.mock("node:child_process", () => ({
	spawn: spawnMock,
}));

vi.mock("node:fs", () => ({
	openSync: openSyncMock,
}));

vi.mock("node:os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:os")>();
	return {
		...actual,
		homedir: () => osMockState.home,
	};
});

import { startLocalRuntime } from "../src/desktop-runtime-control.js";

interface TestRuntimeRecord {
	id: string;
	pid: number;
	cwd: string;
	startedAt: number;
	status?: "running" | "stopped" | "exited";
	command?: string;
	args?: string[];
	sessionId?: string;
	runtimeSource?: string;
}

function jobsDir(): string {
	return join(osMockState.home, ".takumi", "jobs");
}

function logsDir(): string {
	return join(osMockState.home, ".takumi", "logs");
}

async function writeRuntimeRecord(record: TestRuntimeRecord): Promise<void> {
	await mkdir(jobsDir(), { recursive: true });
	await mkdir(logsDir(), { recursive: true });
	await writeFile(
		join(jobsDir(), `${record.id}.json`),
		JSON.stringify(
			{
				...record,
				logFile: join(logsDir(), `${record.id}.log`),
			},
			null,
			2,
		),
		"utf-8",
	);
}

describe("desktop runtime control", () => {
	let originalArgv1: string | undefined;
	let runningPids: Set<number>;
	let killSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(async () => {
		originalArgv1 = process.argv[1];
		process.argv[1] = "/repo/dist/takumi.cjs";
		osMockState.home = await mkdtemp(join(tmpdir(), "takumi-desktop-runtime-"));
		runningPids = new Set<number>();
		spawnMock.mockReset();
		openSyncMock.mockClear();
		killSpy = vi.spyOn(process, "kill").mockImplementation(((pid: number) => {
			if (!runningPids.has(pid)) {
				throw new Error("ESRCH");
			}
			return true;
		}) as typeof process.kill);
	});

	afterEach(async () => {
		killSpy.mockRestore();
		if (originalArgv1 === undefined) delete process.argv[1];
		else process.argv[1] = originalArgv1;
		await rm(osMockState.home, { recursive: true, force: true });
	});

	it("reuses an existing running runtime for the same resumed session", async () => {
		runningPids.add(41001);
		await writeRuntimeRecord({
			id: "rt-existing",
			pid: 41001,
			cwd: "/workspace",
			startedAt: Date.now(),
			status: "running",
			command: process.execPath,
			args: ["/repo/dist/takumi.cjs", "--provider", "anthropic", "--model", "claude-sonnet", "--resume", "session-1"],
			sessionId: "session-1",
			runtimeSource: "desktop",
		});

		const runtime = await startLocalRuntime({
			sessionId: "session-1",
			provider: "anthropic",
			model: "claude-sonnet",
			workingDirectory: "/workspace",
		});

		expect(runtime.runtimeId).toBe("rt-existing");
		expect(spawnMock).not.toHaveBeenCalled();
	});

	it("reuses an existing running fresh runtime for the same request", async () => {
		runningPids.add(41002);
		await writeRuntimeRecord({
			id: "rt-stale-fresh",
			pid: 41002,
			cwd: "/workspace",
			startedAt: Date.now() - 31_000,
			status: "running",
			command: process.execPath,
			args: ["/repo/dist/takumi.cjs", "--provider", "anthropic", "--model", "claude-sonnet"],
			runtimeSource: "desktop",
		});

		const runtime = await startLocalRuntime({
			provider: "anthropic",
			model: "claude-sonnet",
			workingDirectory: "/workspace",
		});

		expect(runtime.runtimeId).toBe("rt-stale-fresh");
		expect(spawnMock).not.toHaveBeenCalled();
	});

	it("deduplicates identical in-flight start requests", async () => {
		runningPids.add(42001);
		spawnMock.mockImplementation(
			() =>
				({
					pid: 42001,
					unref: vi.fn(),
				}) as never,
		);

		const [first, second] = await Promise.all([
			startLocalRuntime({ provider: "anthropic", model: "claude-sonnet", workingDirectory: "/workspace" }),
			startLocalRuntime({ provider: "anthropic", model: "claude-sonnet", workingDirectory: "/workspace" }),
		]);

		expect(spawnMock).toHaveBeenCalledTimes(1);
		expect(first.runtimeId).toBe(second.runtimeId);
		expect(await readdir(jobsDir())).toHaveLength(1);
	});

	it("refuses to start a second live desktop runtime when the singleton is busy", async () => {
		runningPids.add(51001);
		await writeRuntimeRecord({
			id: "rt-alpha",
			pid: 51001,
			cwd: "/workspace-a",
			startedAt: Date.now() - 1000,
			status: "running",
			command: process.execPath,
			args: ["/repo/dist/takumi.cjs", "--provider", "anthropic", "--model", "claude-a"],
			runtimeSource: "desktop",
		});

		await expect(
			startLocalRuntime({
				provider: "anthropic",
				model: "claude-sonnet",
				workingDirectory: "/workspace-c",
			}),
		).rejects.toThrow("Desktop runtime singleton is already active");
		expect(spawnMock).not.toHaveBeenCalled();
	});
});
