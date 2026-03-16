import type { AppState } from "./state.js";

export type ThinkingLevel = "off" | "brief" | "normal" | "deep" | "max";

interface ThinkingPreset {
	level: ThinkingLevel;
	enabled: boolean;
	budget: number;
	label: string;
}

const THINKING_PRESETS: ThinkingPreset[] = [
	{ level: "off", enabled: false, budget: 0, label: "Off" },
	{ level: "brief", enabled: true, budget: 4_096, label: "Brief" },
	{ level: "normal", enabled: true, budget: 12_000, label: "Normal" },
	{ level: "deep", enabled: true, budget: 24_000, label: "Deep" },
	{ level: "max", enabled: true, budget: 48_000, label: "Max" },
];

export function listThinkingLevels(): ThinkingLevel[] {
	return THINKING_PRESETS.map((preset) => preset.level);
}

export function normalizeThinkingLevel(input: string): ThinkingLevel | null {
	const normalized = input.trim().toLowerCase();
	if (normalized === "previous") return null;
	return THINKING_PRESETS.find((preset) => preset.level === normalized)?.level ?? null;
}

export function getThinkingPreset(level: ThinkingLevel): ThinkingPreset {
	return THINKING_PRESETS.find((preset) => preset.level === level) ?? THINKING_PRESETS[0];
}

export function getThinkingLevel(thinking: boolean, budget: number): ThinkingLevel {
	if (!thinking) return "off";
	if (budget <= getThinkingPreset("brief").budget) return "brief";
	if (budget <= getThinkingPreset("normal").budget) return "normal";
	if (budget <= getThinkingPreset("deep").budget) return "deep";
	return "max";
}

export function describeThinkingLevel(level: ThinkingLevel): string {
	const preset = getThinkingPreset(level);
	return preset.enabled ? `${preset.label} (${preset.budget.toLocaleString()} tokens)` : preset.label;
}

export function applyThinkingLevel(state: AppState, level: ThinkingLevel): ThinkingLevel {
	const preset = getThinkingPreset(level);
	state.thinking.value = preset.enabled;
	if (preset.enabled) {
		state.thinkingBudget.value = preset.budget;
	}
	return preset.level;
}

export function cycleThinkingLevel(state: AppState, direction = 1): ThinkingLevel {
	const levels = listThinkingLevels();
	const current = getThinkingLevel(state.thinking.value, state.thinkingBudget.value);
	const index = Math.max(0, levels.indexOf(current));
	const nextIndex = (index + direction + levels.length) % levels.length;
	return applyThinkingLevel(state, levels[nextIndex] ?? "off");
}

export function cycleProviderModel(state: AppState, direction = 1): string | null {
	const provider = state.provider.value;
	const models = state.availableProviderModels.value[provider] ?? [];
	if (models.length === 0) return null;
	const currentIndex = Math.max(0, models.indexOf(state.model.value));
	const nextIndex = (currentIndex + direction + models.length) % models.length;
	const selected = models[nextIndex] ?? null;
	if (selected) {
		state.model.value = selected;
	}
	return selected;
}
