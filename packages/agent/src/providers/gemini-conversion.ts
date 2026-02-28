import type { MessagePayload } from "../loop.js";

/** JSON Schema `format` values that Gemini does NOT support. */
const UNSUPPORTED_FORMATS = new Set([
	"uri",
	"uri-reference",
	"uri-template",
	"iri",
	"iri-reference",
	"json-pointer",
	"relative-json-pointer",
	"regex",
	"idn-email",
	"idn-hostname",
	"hostname",
	"ipv4",
	"ipv6",
	"password",
	"binary",
]);

/** Recursively clean a JSON Schema for Gemini compatibility. */
export function cleanSchema(schema: any): any {
	if (schema == null || typeof schema !== "object") return schema;
	if (Array.isArray(schema)) return schema.map((item) => cleanSchema(item));

	const cleaned: Record<string, any> = {};
	for (const [key, value] of Object.entries(schema)) {
		if (key === "additionalProperties") continue;
		if (key === "format" && typeof value === "string" && UNSUPPORTED_FORMATS.has(value)) continue;
		cleaned[key] = cleanSchema(value);
	}
	return cleaned;
}

/** A single Gemini content part. */
export interface GeminiPart {
	text?: string;
	thought?: boolean;
	functionCall?: { name: string; args: Record<string, unknown> };
	functionResponse?: { name: string; response: { content: any } };
}

/** A Gemini content message. */
export interface GeminiContent {
	role: "user" | "model";
	parts: GeminiPart[];
}

/** Convert Anthropic-format messages to Gemini `contents[]` array. */
export function convertMessages(messages: MessagePayload[]): GeminiContent[] {
	const contents: GeminiContent[] = [];

	// Build a map of tool_use_id → function name so that tool_result blocks
	// can emit a functionResponse.name that matches the original functionCall.name.
	// Gemini requires the names to match; using the raw ID string will cause errors.
	const toolUseNames = new Map<string, string>();
	for (const msg of messages) {
		if (!Array.isArray(msg.content)) continue;
		for (const block of msg.content as any[]) {
			if (block?.type === "tool_use" && block.id && block.name) {
				toolUseNames.set(block.id as string, block.name as string);
			}
		}
	}

	for (const msg of messages) {
		const role: "user" | "model" = msg.role === "assistant" ? "model" : "user";

		if (typeof msg.content === "string") {
			contents.push({ role, parts: [{ text: msg.content }] });
			continue;
		}
		if (!Array.isArray(msg.content)) continue;

		const parts: GeminiPart[] = [];
		for (const block of msg.content) {
			switch (block.type) {
				case "text":
					parts.push({ text: block.text });
					break;
				case "thinking":
					parts.push({ text: block.thinking, thought: true });
					break;
				case "tool_use":
					parts.push({ functionCall: { name: block.name, args: block.input ?? {} } });
					break;
				case "tool_result":
					parts.push({
						functionResponse: {
							// Resolve the actual function name from the pre-built map.
							// Falling back to tool_use_id would cause Gemini to reject
							// the functionResponse since it can't match the ID to a call.
							name: toolUseNames.get(block.tool_use_id as string) ?? block.name ?? block.tool_use_id ?? "unknown",
							response: { content: block.content ?? block.output ?? "" },
						},
					});
					break;
				default:
					if (block.text) parts.push({ text: block.text });
			}
		}
		if (parts.length > 0) contents.push({ role, parts });
	}

	return contents;
}

/** Convert Anthropic-format tool definitions to Gemini `tools[]` format. */
export function convertTools(tools: any[]): any[] {
	if (!tools || tools.length === 0) return [];

	const declarations = tools.map((tool) => {
		const decl: Record<string, any> = {
			name: tool.name,
			description: tool.description || "",
		};
		const schema = tool.input_schema ?? tool.inputSchema;
		if (schema) decl.parameters = cleanSchema(schema);
		return decl;
	});

	return [{ functionDeclarations: declarations }];
}

/** Generate a unique tool call ID for Gemini function-call events. */
export function generateToolCallId(): string {
	const hex = Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
	return `call_${hex}`;
}
