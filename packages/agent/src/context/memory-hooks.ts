/**
 * Agent Memory Hooks — Phase 33.
 *
 * Episodic memory system: automatically extracts "lessons" from each
 * agent session and stores them for retrieval in future sessions.
 *
 * Lessons are short, reusable observations like:
 *   - "This project uses vitest, not jest"
 *   - "The user prefers tabs over spaces"
 *   - "Module X depends on Y — always update both"
 *
 * The extraction is heuristic-based (no LLM call needed):
 *   1. Tool correction patterns (agent tried X, got error, then tried Y)
 *   2. User corrections ("No, use ... instead")
 *   3. Repeated file accesses (signals important files)
 *   4. Configuration discoveries (from project detection)
 *
 * Storage is a simple JSON file in `.takumi/memory/lessons.json`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "@takumi/core";

const log = createLogger("memory-hooks");

// ── Types ────────────────────────────────────────────────────────────────────

export interface Lesson {
	/** Unique identifier. */
	id: string;
	/** The lesson text. */
	text: string;
	/** Category of the lesson. */
	category: "tool_pattern" | "user_preference" | "project_knowledge" | "error_pattern";
	/** When the lesson was first learned. */
	createdAt: number;
	/** When the lesson was last reinforced/confirmed. */
	lastSeen: number;
	/** How many times this lesson has been reinforced. */
	confidence: number;
	/** The project this lesson applies to (or "global"). */
	scope: string;
}

export interface MemoryHooksConfig {
	/** Project root directory. */
	cwd: string;
	/** Project identifier (default: directory name). */
	projectId?: string;
	/** Maximum lessons to retain per project (default: 100). */
	maxLessons?: number;
}

export interface ExtractionEvent {
	/** What happened. */
	type: "tool_error_then_success" | "user_correction" | "repeated_access" | "config_discovery";
	/** Raw details for extraction. */
	details: string;
	/** Associated file, if any. */
	file?: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const MEMORY_DIR = ".takumi/memory";
const LESSONS_FILE = "lessons.json";
const MAX_LESSONS = 100;
const MAX_LESSON_LENGTH = 200;

// ── MemoryHooks class ────────────────────────────────────────────────────────

export class MemoryHooks {
	private lessons: Lesson[] = [];
	private readonly dir: string;
	private readonly filePath: string;
	private readonly projectId: string;
	private readonly maxLessons: number;

	constructor(config: MemoryHooksConfig) {
		this.dir = join(config.cwd, MEMORY_DIR);
		this.filePath = join(this.dir, LESSONS_FILE);
		this.projectId = config.projectId ?? config.cwd.split("/").pop() ?? "unknown";
		this.maxLessons = config.maxLessons ?? MAX_LESSONS;
	}

	/** Load lessons from disk. */
	load(): void {
		if (!existsSync(this.filePath)) {
			this.lessons = [];
			return;
		}
		try {
			const raw = readFileSync(this.filePath, "utf-8");
			this.lessons = JSON.parse(raw) as Lesson[];
			log.debug(`Loaded ${this.lessons.length} lessons for ${this.projectId}`);
		} catch {
			log.warn("Failed to parse lessons file, starting fresh");
			this.lessons = [];
		}
	}

	/** Save lessons to disk. */
	save(): void {
		mkdirSync(this.dir, { recursive: true });
		writeFileSync(this.filePath, JSON.stringify(this.lessons, null, "\t"), "utf-8");
		log.debug(`Saved ${this.lessons.length} lessons`);
	}

	/**
	 * Extract a lesson from an event.
	 * Returns the new or reinforced lesson, or null if the event isn't useful.
	 */
	extract(event: ExtractionEvent): Lesson | null {
		const text = this.formatLesson(event);
		if (!text) return null;

		// Check for existing similar lesson (simple substring containment)
		const existing = this.lessons.find((l) => l.text === text || l.text.includes(text) || text.includes(l.text));

		if (existing) {
			existing.lastSeen = Date.now();
			existing.confidence = Math.min(existing.confidence + 1, 10);
			return existing;
		}

		const lesson: Lesson = {
			id: `lesson-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			text: text.slice(0, MAX_LESSON_LENGTH),
			category: this.categorize(event),
			createdAt: Date.now(),
			lastSeen: Date.now(),
			confidence: 1,
			scope: this.projectId,
		};

		this.lessons.push(lesson);

		// Evict lowest-confidence lessons if over limit
		if (this.lessons.length > this.maxLessons) {
			this.lessons.sort((a, b) => b.confidence - a.confidence || b.lastSeen - a.lastSeen);
			this.lessons = this.lessons.slice(0, this.maxLessons);
		}

		log.info(`New lesson: "${lesson.text}"`);
		return lesson;
	}

	/** Get lessons relevant to a given context (file path or query). */
	recall(query: string, limit = 5): Lesson[] {
		const queryLower = query.toLowerCase();
		const scored = this.lessons
			.map((lesson) => {
				let score = lesson.confidence;
				// Boost if the lesson text mentions the query
				if (lesson.text.toLowerCase().includes(queryLower)) score += 5;
				// Boost recent lessons
				const ageHours = (Date.now() - lesson.lastSeen) / (1000 * 60 * 60);
				if (ageHours < 24) score += 2;
				return { lesson, score };
			})
			.filter((s) => s.score > 1)
			.sort((a, b) => b.score - a.score);

		return scored.slice(0, limit).map((s) => s.lesson);
	}

	/** Format recalled lessons into a prompt-friendly string. */
	formatForPrompt(lessons: Lesson[]): string {
		if (lessons.length === 0) return "";
		const items = lessons.map((l) => `- ${l.text} (confidence: ${l.confidence})`);
		return ["## Lessons from previous sessions", "", ...items].join("\n");
	}

	/** Get all lessons (for testing/inspection). */
	getAll(): Lesson[] {
		return [...this.lessons];
	}

	/** Clear all lessons. */
	clear(): void {
		this.lessons = [];
	}

	// ── Internal ─────────────────────────────────────────────────────────────

	private formatLesson(event: ExtractionEvent): string | null {
		switch (event.type) {
			case "tool_error_then_success":
				return event.details.length > 10 ? `When ${event.details}` : null;
			case "user_correction":
				return event.details.length > 5 ? `User prefers: ${event.details}` : null;
			case "repeated_access":
				return event.file ? `Important file: ${event.file}` : null;
			case "config_discovery":
				return event.details.length > 5 ? `Project config: ${event.details}` : null;
			default:
				return null;
		}
	}

	private categorize(event: ExtractionEvent): Lesson["category"] {
		switch (event.type) {
			case "tool_error_then_success":
				return "error_pattern";
			case "user_correction":
				return "user_preference";
			case "repeated_access":
				return "project_knowledge";
			case "config_discovery":
				return "project_knowledge";
		}
	}
}
