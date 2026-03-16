import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore, createHubArtifact, resetArtifactCounter } from "@takumi/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("ArtifactStore", () => {
	let dir: string;
	let store: ArtifactStore;

	beforeEach(async () => {
		resetArtifactCounter();
		dir = await mkdtemp(join(tmpdir(), "takumi-artifact-test-"));
		store = new ArtifactStore({ baseDir: dir });
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("save and load round-trip", async () => {
		const art = createHubArtifact({
			kind: "plan",
			producer: "takumi.exec",
			summary: "A test plan",
		});
		await store.save(art, "sess-1");
		const loaded = await store.load(art.artifactId);

		expect(loaded).not.toBeNull();
		expect(loaded!.artifactId).toBe(art.artifactId);
		expect(loaded!.kind).toBe("plan");
		expect(loaded!._sessionId).toBe("sess-1");
	});

	it("load returns null for missing artifact", async () => {
		const loaded = await store.load("art-nonexistent");
		expect(loaded).toBeNull();
	});

	it("remove deletes artifact", async () => {
		const art = createHubArtifact({
			kind: "implementation",
			producer: "takumi.exec",
			summary: "Impl artifact",
		});
		await store.save(art);
		expect(await store.load(art.artifactId)).not.toBeNull();

		await store.remove(art.artifactId);
		expect(await store.load(art.artifactId)).toBeNull();
	});

	it("query filters by kind", async () => {
		const plan = createHubArtifact({ kind: "plan", producer: "takumi.exec", summary: "Plan" });
		const impl = createHubArtifact({ kind: "implementation", producer: "takumi.exec", summary: "Impl" });
		await store.save(plan, "sess-1");
		await store.save(impl, "sess-1");

		const results = await store.query({ kind: "plan" });
		expect(results).toHaveLength(1);
		expect(results[0].kind).toBe("plan");
	});

	it("query filters by sessionId", async () => {
		const a = createHubArtifact({ kind: "plan", producer: "takumi.exec", summary: "A" });
		const b = createHubArtifact({ kind: "plan", producer: "takumi.exec", summary: "B" });
		await store.save(a, "sess-1");
		await store.save(b, "sess-2");

		const results = await store.query({ sessionId: "sess-1" });
		expect(results).toHaveLength(1);
		expect(results[0].summary).toBe("A");
	});

	it("query respects limit", async () => {
		for (let i = 0; i < 5; i++) {
			const art = createHubArtifact({ kind: "plan", producer: "takumi.exec", summary: `Plan ${i}` });
			await store.save(art, "sess-1");
		}

		const results = await store.query({ limit: 2 });
		expect(results).toHaveLength(2);
	});

	it("manifest returns lightweight entries", async () => {
		const art = createHubArtifact({
			kind: "validation",
			producer: "takumi.exec",
			summary: "Validation result",
			taskId: "task-1",
		});
		await store.save(art, "sess-1");

		const entries = await store.manifest();
		expect(entries).toHaveLength(1);
		expect(entries[0].artifactId).toBe(art.artifactId);
		expect(entries[0].sessionId).toBe("sess-1");
		expect(entries[0].kind).toBe("validation");
	});
});
