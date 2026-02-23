/**
 * Tests for TaskClassifier
 */

import type { AgentEvent } from "@takumi/core";
import { describe, expect, it, vi } from "vitest";
import { TaskClassifier, TaskComplexity, TaskType } from "../src/classifier.js";
import type { MessagePayload } from "../src/loop.js";

describe("TaskClassifier", () => {
	// Mock sendMessage function
	const mockSendMessage = (responseJson: string) => {
		return vi.fn(async function* (_messages: MessagePayload[], _system: string): AsyncGenerator<AgentEvent> {
			yield { type: "text_delta", text: responseJson };
			yield { type: "done", stopReason: "end_turn" };
		});
	};

	describe("classify", () => {
		it("classifies a trivial task correctly", async () => {
			const response = JSON.stringify({
				complexity: "TRIVIAL",
				type: "CODING",
				estimatedFiles: 1,
				riskLevel: 1,
				confidence: 0.9,
				reasoning: "Simple typo fix in one file",
			});

			const classifier = new TaskClassifier({
				sendMessage: mockSendMessage(response),
			});

			const result = await classifier.classify("Fix typo in README");

			expect(result.complexity).toBe(TaskComplexity.TRIVIAL);
			expect(result.type).toBe(TaskType.CODING);
			expect(result.estimatedFiles).toBe(1);
			expect(result.riskLevel).toBe(1);
			expect(result.confidence).toBe(0.9);
		});

		it("classifies a critical task correctly", async () => {
			const response = JSON.stringify({
				complexity: "CRITICAL",
				type: "CODING",
				estimatedFiles: 15,
				riskLevel: 10,
				confidence: 0.95,
				reasoning: "Authentication system is security-critical",
			});

			const classifier = new TaskClassifier({
				sendMessage: mockSendMessage(response),
			});

			const result = await classifier.classify("Implement OAuth2 authentication");

			expect(result.complexity).toBe(TaskComplexity.CRITICAL);
			expect(result.type).toBe(TaskType.CODING);
			expect(result.estimatedFiles).toBe(15);
			expect(result.riskLevel).toBe(10);
		});

		it("classifies a refactor task correctly", async () => {
			const response = JSON.stringify({
				complexity: "STANDARD",
				type: "REFACTOR",
				estimatedFiles: 8,
				riskLevel: 6,
				confidence: 0.85,
				reasoning: "Refactoring multiple modules requires careful coordination",
			});

			const classifier = new TaskClassifier({
				sendMessage: mockSendMessage(response),
			});

			const result = await classifier.classify("Refactor database layer to use repository pattern");

			expect(result.complexity).toBe(TaskComplexity.STANDARD);
			expect(result.type).toBe(TaskType.REFACTOR);
		});

		it("handles JSON wrapped in markdown code blocks", async () => {
			const response = `Here's the classification:

\`\`\`json
{
  "complexity": "SIMPLE",
  "type": "DEBUG",
  "estimatedFiles": 2,
  "riskLevel": 3,
  "confidence": 0.8,
  "reasoning": "Bug fix in a couple of files"
}
\`\`\``;

			const classifier = new TaskClassifier({
				sendMessage: mockSendMessage(response),
			});

			const result = await classifier.classify("Fix null pointer exception in user service");

			expect(result.complexity).toBe(TaskComplexity.SIMPLE);
			expect(result.type).toBe(TaskType.DEBUG);
		});

		it("falls back to heuristics on LLM error", async () => {
			const errorSendMessage = vi.fn(async function* (): AsyncGenerator<AgentEvent> {
				yield { type: "error", error: new Error("API error") };
			});

			const classifier = new TaskClassifier({
				sendMessage: errorSendMessage,
			});

			const result = await classifier.classify("Implement payment processing");

			// Should detect "payment" as critical
			expect(result.complexity).toBe(TaskComplexity.CRITICAL);
			expect(result.confidence).toBeLessThan(0.5); // Low confidence for fallback
		});

		it("falls back to heuristics on invalid JSON", async () => {
			const classifier = new TaskClassifier({
				sendMessage: mockSendMessage("This is not JSON"),
			});

			const result = await classifier.classify("Add logging");

			// Should detect "log" as trivial
			expect(result.complexity).toBe(TaskComplexity.TRIVIAL);
			expect(result.confidence).toBe(0.3);
		});
	});

	describe("getTopology", () => {
		const classifier = new TaskClassifier({
			sendMessage: mockSendMessage("{}"),
		});

		it("returns correct topology for TRIVIAL", () => {
			const topology = classifier.getTopology(TaskComplexity.TRIVIAL);
			expect(topology.totalAgents).toBe(1);
			expect(topology.validatorCount).toBe(0);
			expect(topology.usePlanner).toBe(false);
			expect(topology.validationStrategy).toBe("none");
		});

		it("returns correct topology for SIMPLE", () => {
			const topology = classifier.getTopology(TaskComplexity.SIMPLE);
			expect(topology.totalAgents).toBe(2);
			expect(topology.validatorCount).toBe(1);
			expect(topology.usePlanner).toBe(false);
			expect(topology.validationStrategy).toBe("single");
		});

		it("returns correct topology for STANDARD", () => {
			const topology = classifier.getTopology(TaskComplexity.STANDARD);
			expect(topology.totalAgents).toBe(4);
			expect(topology.validatorCount).toBe(2);
			expect(topology.usePlanner).toBe(true);
			expect(topology.validationStrategy).toBe("majority");
		});

		it("returns correct topology for CRITICAL", () => {
			const topology = classifier.getTopology(TaskComplexity.CRITICAL);
			expect(topology.totalAgents).toBe(7);
			expect(topology.validatorCount).toBe(5);
			expect(topology.usePlanner).toBe(true);
			expect(topology.validationStrategy).toBe("all_approve");
		});
	});

	describe("classifyAndGetTopology", () => {
		it("returns both classification and topology", async () => {
			const response = JSON.stringify({
				complexity: "STANDARD",
				type: "CODING",
				estimatedFiles: 10,
				riskLevel: 7,
				confidence: 0.9,
				reasoning: "Complex feature spanning multiple modules",
			});

			const classifier = new TaskClassifier({
				sendMessage: mockSendMessage(response),
			});

			const result = await classifier.classifyAndGetTopology("Implement real-time notifications");

			expect(result.classification.complexity).toBe(TaskComplexity.STANDARD);
			expect(result.topology.totalAgents).toBe(4);
			expect(result.topology.validatorCount).toBe(2);
		});
	});

	describe("fallback classification", () => {
		const errorSendMessage = vi.fn(async function* (): AsyncGenerator<AgentEvent> {
			yield { type: "error", error: new Error("API error") };
		});

		const classifier = new TaskClassifier({
			sendMessage: errorSendMessage,
		});

		it("detects critical keywords", async () => {
			const tasks = [
				"Implement authentication system",
				"Add password hashing",
				"Setup payment gateway",
				"Implement crypto wallet",
			];

			for (const task of tasks) {
				const result = await classifier.classify(task);
				expect(result.complexity).toBe(TaskComplexity.CRITICAL);
			}
		});

		it("detects trivial keywords", async () => {
			const tasks = ["Fix typo in comment", "Add console.log for debugging", "Rename variable", "Short task"];

			for (const task of tasks) {
				const result = await classifier.classify(task);
				expect(result.complexity).toBe(TaskComplexity.TRIVIAL);
			}
		});

		it("detects task types", async () => {
			const tests = [
				{ task: "Refactor user module", expectedType: TaskType.REFACTOR },
				{ task: "Fix bug in login", expectedType: TaskType.DEBUG },
				{ task: "Review pull request", expectedType: TaskType.REVIEW },
				{ task: "Research best practices", expectedType: TaskType.RESEARCH },
				{ task: "Add new feature", expectedType: TaskType.CODING },
			];

			for (const { task, expectedType } of tests) {
				const result = await classifier.classify(task);
				expect(result.type).toBe(expectedType);
			}
		});
	});
});
