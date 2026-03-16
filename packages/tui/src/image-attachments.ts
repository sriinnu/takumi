import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

export interface ImageAttachment {
	mediaType: string;
	data: string;
	sourceLabel: string;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const EXTENSION_MEDIA_TYPES: Record<string, string> = {
	".gif": "image/gif",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".png": "image/png",
	".webp": "image/webp",
};

export function parseLeadingArgument(input: string): { value: string; rest: string } {
	const trimmed = input.trim();
	if (!trimmed) {
		return { value: "", rest: "" };
	}

	const quote = trimmed[0];
	if (quote === '"' || quote === "'") {
		const end = trimmed.indexOf(quote, 1);
		if (end > 0) {
			return {
				value: trimmed.slice(1, end),
				rest: trimmed.slice(end + 1).trim(),
			};
		}
	}

	const boundary = trimmed.search(/\s/);
	if (boundary === -1) {
		return { value: trimmed, rest: "" };
	}

	return {
		value: trimmed.slice(0, boundary),
		rest: trimmed.slice(boundary + 1).trim(),
	};
}

export async function loadImageAttachment(input: string, cwd = process.cwd()): Promise<ImageAttachment> {
	if (input.startsWith("data:")) {
		return loadDataUrlAttachment(input);
	}

	const absolutePath = resolve(cwd, input);
	const mediaType = inferMediaTypeFromPath(absolutePath);
	const file = await readFile(absolutePath);
	if (file.byteLength > MAX_IMAGE_BYTES) {
		throw new Error(`Image exceeds 5 MB limit: ${input}`);
	}

	return {
		mediaType,
		data: file.toString("base64"),
		sourceLabel: absolutePath,
	};
}

function loadDataUrlAttachment(input: string): ImageAttachment {
	const match = input.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
	if (!match) {
		throw new Error("Data URL must be base64-encoded and use an image/* media type");
	}

	const [, mediaType, rawData] = match;
	const normalized = rawData.replace(/\s+/g, "");
	const file = Buffer.from(normalized, "base64");
	if (file.byteLength > MAX_IMAGE_BYTES) {
		throw new Error("Image data URL exceeds 5 MB limit");
	}

	return {
		mediaType,
		data: normalized,
		sourceLabel: "data-url",
	};
}

function inferMediaTypeFromPath(filePath: string): string {
	const extension = extname(filePath).toLowerCase();
	const mediaType = EXTENSION_MEDIA_TYPES[extension];
	if (!mediaType) {
		throw new Error(`Unsupported image type: ${extension || "(no extension)"}`);
	}
	return mediaType;
}
