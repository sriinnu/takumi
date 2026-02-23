import { batch, computed, effect, signal, untrack } from "@takumi/render";
import { describe, expect, it, vi } from "vitest";

describe("signal", () => {
	it("holds a value and allows reads/writes", () => {
		const s = signal(42);
		expect(s.value).toBe(42);
		s.value = 100;
		expect(s.value).toBe(100);
	});

	it("does not notify when set to same value (Object.is)", () => {
		const s = signal(1);
		const fn = vi.fn();
		effect(() => {
			fn(s.value);
		});
		expect(fn).toHaveBeenCalledTimes(1);
		s.value = 1; // same value
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("peek() reads without tracking", () => {
		const s = signal(10);
		const fn = vi.fn();
		effect(() => {
			fn(s.peek());
		});
		expect(fn).toHaveBeenCalledTimes(1);
		s.value = 20;
		// Effect should NOT re-run because we used peek()
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("subscribe() works and returns unsubscribe", () => {
		const s = signal("hello");
		const values: string[] = [];
		const unsub = s.subscribe((v) => values.push(v));
		s.value = "world";
		s.value = "!";
		unsub();
		s.value = "ignored";
		expect(values).toEqual(["hello", "world", "!"]);
	});
});

describe("computed", () => {
	it("derives value from signals", () => {
		const a = signal(2);
		const b = signal(3);
		const sum = computed(() => a.value + b.value);
		expect(sum.value).toBe(5);
		a.value = 10;
		expect(sum.value).toBe(13);
	});

	it("is lazy — only recomputes when read", () => {
		const s = signal(0);
		const fn = vi.fn(() => s.value * 2);
		const c = computed(fn);
		expect(fn).not.toHaveBeenCalled();
		expect(c.value).toBe(0);
		expect(fn).toHaveBeenCalledTimes(1);
		s.value = 5;
		// Not recomputed yet
		expect(fn).toHaveBeenCalledTimes(1);
		expect(c.value).toBe(10);
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("caches value when dependencies unchanged", () => {
		const s = signal(1);
		const fn = vi.fn(() => s.value);
		const c = computed(fn);
		c.value;
		c.value;
		c.value;
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("chains computeds", () => {
		const base = signal(2);
		const doubled = computed(() => base.value * 2);
		const quadrupled = computed(() => doubled.value * 2);
		expect(quadrupled.value).toBe(8);
		base.value = 5;
		expect(quadrupled.value).toBe(20);
	});
});

describe("effect", () => {
	it("runs immediately on creation", () => {
		const fn = vi.fn();
		const dispose = effect(fn);
		expect(fn).toHaveBeenCalledTimes(1);
		dispose();
	});

	it("re-runs when dependencies change", () => {
		const s = signal(0);
		const values: number[] = [];
		const dispose = effect(() => {
			values.push(s.value);
		});
		s.value = 1;
		s.value = 2;
		expect(values).toEqual([0, 1, 2]);
		dispose();
	});

	it("stops running after dispose", () => {
		const s = signal(0);
		const fn = vi.fn(() => s.value);
		const dispose = effect(fn);
		expect(fn).toHaveBeenCalledTimes(1);
		dispose();
		s.value = 1;
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("calls cleanup function from previous run", () => {
		const s = signal(0);
		const cleanup = vi.fn();
		const dispose = effect(() => {
			s.value; // track
			return cleanup;
		});
		expect(cleanup).not.toHaveBeenCalled();
		s.value = 1;
		expect(cleanup).toHaveBeenCalledTimes(1);
		dispose();
		expect(cleanup).toHaveBeenCalledTimes(2); // cleanup on dispose
	});
});

describe("batch", () => {
	it("defers effects until batch completes", () => {
		const a = signal(1);
		const b = signal(2);
		const fn = vi.fn(() => a.value + b.value);
		effect(fn);
		expect(fn).toHaveBeenCalledTimes(1);

		batch(() => {
			a.value = 10;
			b.value = 20;
			// Effect should NOT have run yet
			expect(fn).toHaveBeenCalledTimes(1);
		});

		// Now it runs once with final values
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("supports nested batches", () => {
		const s = signal(0);
		const fn = vi.fn(() => s.value);
		effect(fn);

		batch(() => {
			s.value = 1;
			batch(() => {
				s.value = 2;
			});
			// Still in outer batch — should not have notified
			expect(fn).toHaveBeenCalledTimes(1);
		});

		expect(fn).toHaveBeenCalledTimes(2);
	});
});

describe("untrack", () => {
	it("reads signals without creating dependencies", () => {
		const tracked = signal(0);
		const untracked_s = signal(100);
		const fn = vi.fn(() => {
			return tracked.value + untrack(() => untracked_s.value);
		});
		const dispose = effect(fn);
		expect(fn).toHaveBeenCalledTimes(1);

		untracked_s.value = 200;
		expect(fn).toHaveBeenCalledTimes(1); // should not re-run

		tracked.value = 1;
		expect(fn).toHaveBeenCalledTimes(2); // should re-run

		dispose();
	});
});
