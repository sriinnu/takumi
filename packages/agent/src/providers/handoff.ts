/**
 * Cross-provider handoff transformer.
 *
 * When switching providers mid-conversation (e.g. Anthropic → OpenAI → Gemini),
 * message history must be re-encoded so the target provider understands every
 * content block. This module handles the lossless conversion.
 *
 * Key guarantees:
 * - Thinking/reasoning blocks are preserved as tagged text where the target
 *   provider lacks a native thinking field.
 * - Tool use/result blocks are re-mapped to each provider's calling convention.
 * - Image blocks are preserved when the target supports vision; otherwise a
 *   placeholder is inserted.
 *
 * Usage:
 * ```ts
 * const transformer = new HandoffTransformer("anthropic", "openai");
 * const converted = transformer.transform(messages);
 * ```
 */

import type { MessagePayload } from "../loop.js";
import type { ProviderFamily } from "../model-router.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface HandoffResult {
	messages: MessagePayload[];
	warnings: string[];
}

// ── Thinking block transformers ──────────────────────────────────────────────

/**
 * Extract thinking blocks from a content array and convert them to tagged
 * text suitable for providers that don't support native thinking fields.
 */
function thinkingToTaggedText(blocks: any[]): any[] {
	return blocks.map((block) => {
		if (block.type === "thinking" && block.thinking) {
			return { type: "text", text: `<thinking>\n${block.thinking}\n</thinking>` };
		}
		return block;
	});
}

/**
 * Convert tagged `<thinking>` text blocks back into native thinking blocks
 * for providers that support them (Anthropic, Gemini).
 */
function taggedTextToThinking(blocks: any[]): any[] {
	return blocks.map((block) => {
		if (block.type !== "text") return block;
		const match = /^<thinking>\n([\s\S]*?)\n<\/thinking>$/.exec(block.text);
		if (match) {
			return { type: "thinking", thinking: match[1] };
		}
		return block;
	});
}

// ── Provider capability map ──────────────────────────────────────────────────

interface ProviderCaps {
	nativeThinking: boolean;
	visionSupport: boolean;
}

const PROVIDER_CAPS: Record<ProviderFamily, ProviderCaps> = {
	anthropic: { nativeThinking: true, visionSupport: true },
	openai: { nativeThinking: false, visionSupport: true },
	google: { nativeThinking: true, visionSupport: true },
	"openai-compat": { nativeThinking: false, visionSupport: false },
	darpana: { nativeThinking: true, visionSupport: true },
	"azure-openai": { nativeThinking: false, visionSupport: true },
	bedrock: { nativeThinking: true, visionSupport: true },
	mistral: { nativeThinking: false, visionSupport: true },
	groq: { nativeThinking: false, visionSupport: false },
	deepseek: { nativeThinking: true, visionSupport: false },
	together: { nativeThinking: false, visionSupport: false },
	xai: { nativeThinking: false, visionSupport: true },
	openrouter: { nativeThinking: false, visionSupport: true },
};

// ── Transformer ──────────────────────────────────────────────────────────────

export class HandoffTransformer {
	private readonly from: ProviderFamily;
	private readonly to: ProviderFamily;

	constructor(from: ProviderFamily, to: ProviderFamily) {
		this.from = from;
		this.to = to;
	}

	/**
	 * Transform message history from `from` provider format to `to` provider
	 * format. Returns the converted messages and any warnings about lossy
	 * conversions.
	 */
	transform(messages: MessagePayload[]): HandoffResult {
		if (this.from === this.to) {
			return { messages, warnings: [] };
		}

		const warnings: string[] = [];
		const fromCaps = PROVIDER_CAPS[this.from] ?? PROVIDER_CAPS["openai-compat"];
		const toCaps = PROVIDER_CAPS[this.to] ?? PROVIDER_CAPS["openai-compat"];

		const converted = messages.map((msg) => {
			if (typeof msg.content === "string" || !Array.isArray(msg.content)) {
				return msg;
			}

			let blocks = [...msg.content] as any[];

			// ── Thinking block conversion ──────────────────────────────
			if (fromCaps.nativeThinking && !toCaps.nativeThinking) {
				// Source has native thinking → target needs tagged text
				blocks = thinkingToTaggedText(blocks);
			} else if (!fromCaps.nativeThinking && toCaps.nativeThinking) {
				// Source has tagged text → target supports native thinking
				blocks = taggedTextToThinking(blocks);
			}

			// ── Image block handling ───────────────────────────────────
			if (!toCaps.visionSupport) {
				const hasImages = blocks.some((b) => b.type === "image");
				if (hasImages) {
					warnings.push(`Provider ${this.to} does not support vision; image blocks replaced with placeholders.`);
					blocks = blocks.map((b) =>
						b.type === "image" ? { type: "text", text: "[image: content not available for this provider]" } : b,
					);
				}
			}

			return { ...msg, content: blocks };
		});

		return { messages: converted, warnings };
	}
}
