import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { ConfigError } from "../src/errors.js";

describe("Orchestration validation", () => {
	describe("ensemble validation", () => {
		it("should reject workerCount < 2", () => {
			expect(() =>
				loadConfig({
					orchestration: {
						enabled: true,
						defaultMode: "multi",
						complexityThreshold: "STANDARD",
						maxValidationRetries: 3,
						isolationMode: "none",
						ensemble: {
							enabled: true,
							workerCount: 1,
							temperature: 0.9,
							parallel: true,
						},
					},
				}),
			).toThrow(ConfigError);
		});

		it("should reject workerCount > 7", () => {
			expect(() =>
				loadConfig({
					orchestration: {
						enabled: true,
						defaultMode: "multi",
						complexityThreshold: "STANDARD",
						maxValidationRetries: 3,
						isolationMode: "none",
						ensemble: {
							enabled: true,
							workerCount: 8,
							temperature: 0.9,
							parallel: true,
						},
					},
				}),
			).toThrow(ConfigError);
		});

		it("should accept valid ensemble config", () => {
			expect(() =>
				loadConfig({
					orchestration: {
						enabled: true,
						defaultMode: "multi",
						complexityThreshold: "STANDARD",
						maxValidationRetries: 3,
						isolationMode: "none",
						ensemble: {
							enabled: true,
							workerCount: 5,
							temperature: 0.8,
							parallel: true,
						},
					},
				}),
			).not.toThrow();
		});
	});

	describe("MoA validation", () => {
		it("should reject rounds < 1", () => {
			expect(() =>
				loadConfig({
					orchestration: {
						enabled: true,
						defaultMode: "multi",
						complexityThreshold: "STANDARD",
						maxValidationRetries: 3,
						isolationMode: "none",
						moA: {
							enabled: true,
							rounds: 0,
							validatorCount: 3,
							allowCrossTalk: true,
							temperatures: [0.2, 0.1],
						},
					},
				}),
			).toThrow(ConfigError);
		});

		it("should reject insufficient temperatures", () => {
			expect(() =>
				loadConfig({
					orchestration: {
						enabled: true,
						defaultMode: "multi",
						complexityThreshold: "STANDARD",
						maxValidationRetries: 3,
						isolationMode: "none",
						moA: {
							enabled: true,
							rounds: 3,
							validatorCount: 3,
							allowCrossTalk: true,
							temperatures: [0.2, 0.1],
						},
					},
				}),
			).toThrow(ConfigError);
		});

		it("should accept valid MoA config", () => {
			expect(() =>
				loadConfig({
					orchestration: {
						enabled: true,
						defaultMode: "multi",
						complexityThreshold: "STANDARD",
						maxValidationRetries: 3,
						isolationMode: "none",
						moA: {
							enabled: true,
							rounds: 2,
							validatorCount: 3,
							allowCrossTalk: true,
							temperatures: [0.2, 0.1, 0.05],
						},
					},
				}),
			).not.toThrow();
		});
	});

	describe("progressive refinement validation", () => {
		it("should reject maxIterations > 5", () => {
			expect(() =>
				loadConfig({
					orchestration: {
						enabled: true,
						defaultMode: "multi",
						complexityThreshold: "STANDARD",
						maxValidationRetries: 3,
						isolationMode: "none",
						progressiveRefinement: {
							enabled: true,
							maxIterations: 6,
							minImprovement: 0.05,
							useCriticModel: true,
							targetScore: 9.0,
						},
					},
				}),
			).toThrow(ConfigError);
		});

		it("should accept valid progressive refinement config", () => {
			expect(() =>
				loadConfig({
					orchestration: {
						enabled: true,
						defaultMode: "multi",
						complexityThreshold: "STANDARD",
						maxValidationRetries: 3,
						isolationMode: "none",
						progressiveRefinement: {
							enabled: true,
							maxIterations: 3,
							minImprovement: 0.05,
							useCriticModel: true,
							targetScore: 9.0,
						},
					},
				}),
			).not.toThrow();
		});
	});

	describe("conflict detection", () => {
		it("should reject ensemble + progressive refinement", () => {
			expect(() =>
				loadConfig({
					orchestration: {
						enabled: true,
						defaultMode: "multi",
						complexityThreshold: "STANDARD",
						maxValidationRetries: 3,
						isolationMode: "none",
						ensemble: {
							enabled: true,
							workerCount: 3,
							temperature: 0.9,
							parallel: true,
						},
						progressiveRefinement: {
							enabled: true,
							maxIterations: 3,
							minImprovement: 0.05,
							useCriticModel: true,
							targetScore: 9.0,
						},
					},
				}),
			).toThrow(ConfigError);
		});
	});

	describe("default config", () => {
		it("should load with all new strategies disabled by default", () => {
			const config = loadConfig();
			expect(config.orchestration?.ensemble?.enabled).toBe(false);
			expect(config.orchestration?.reflexion?.enabled).toBe(false);
			expect(config.orchestration?.moA?.enabled).toBe(false);
			expect(config.orchestration?.progressiveRefinement?.enabled).toBe(false);
			expect(config.orchestration?.adaptiveTemperature?.enabled).toBe(true);
		});
	});
});
