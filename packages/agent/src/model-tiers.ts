/**
 * Model tier tables — preferred model per tier for each provider family.
 *
 * Extracted from model-router.ts to keep both files under the 450-LOC
 * guardrail. Update these strings when new models are released.
 */

import type { ModelTier, ProviderFamily } from "./model-router.js";

export const MODEL_TIERS: Record<ProviderFamily, Record<ModelTier, string>> = {
	anthropic: {
		fast: "claude-haiku-4-20250514",
		balanced: "claude-sonnet-4-20250514",
		powerful: "claude-sonnet-4-5",
		frontier: "claude-opus-4-5",
	},
	openai: {
		fast: "gpt-4o-mini",
		balanced: "gpt-4o",
		powerful: "gpt-4o",
		frontier: "o3",
	},
	google: {
		fast: "gemini-2.0-flash",
		balanced: "gemini-2.5-flash",
		powerful: "gemini-2.5-pro",
		frontier: "gemini-2.5-pro",
	},
	"openai-compat": {
		fast: "gpt-4o-mini",
		balanced: "gpt-4o",
		powerful: "gpt-4o",
		frontier: "gpt-4o",
	},
	darpana: {
		fast: "claude-haiku-4-20250514",
		balanced: "claude-sonnet-4-20250514",
		powerful: "claude-sonnet-4-5",
		frontier: "claude-opus-4-5",
	},
	"azure-openai": {
		fast: "gpt-4o-mini",
		balanced: "gpt-4o",
		powerful: "gpt-4o",
		frontier: "o3",
	},
	bedrock: {
		fast: "anthropic.claude-3-5-haiku-20241022-v1:0",
		balanced: "anthropic.claude-sonnet-4-20250514-v1:0",
		powerful: "anthropic.claude-sonnet-4-5-20250514-v1:0",
		frontier: "anthropic.claude-opus-4-5-20250514-v1:0",
	},
	mistral: {
		fast: "mistral-small-latest",
		balanced: "mistral-medium-latest",
		powerful: "mistral-large-latest",
		frontier: "mistral-large-latest",
	},
	groq: {
		fast: "llama-3.1-8b-instant",
		balanced: "llama-3.3-70b-versatile",
		powerful: "llama-3.3-70b-versatile",
		frontier: "llama-3.3-70b-versatile",
	},
	deepseek: {
		fast: "deepseek-chat",
		balanced: "deepseek-chat",
		powerful: "deepseek-reasoner",
		frontier: "deepseek-reasoner",
	},
	together: {
		fast: "meta-llama/Llama-3.1-8B-Instruct-Turbo",
		balanced: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
		powerful: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
		frontier: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
	},
	xai: {
		fast: "grok-3-mini-fast",
		balanced: "grok-3-mini",
		powerful: "grok-3",
		frontier: "grok-3",
	},
	openrouter: {
		fast: "anthropic/claude-haiku-4",
		balanced: "anthropic/claude-sonnet-4",
		powerful: "anthropic/claude-sonnet-4-5",
		frontier: "anthropic/claude-opus-4-5",
	},
};
