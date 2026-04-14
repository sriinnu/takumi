/**
 * Push-based SSE frame parser.
 *
 * I extract the frame-level parsing logic shared by all SSE provider streams
 * (Anthropic, OpenAI, Gemini) into a single reusable layer. Chunked
 * Transfer-Encoding is handled correctly — partial frames are buffered across
 * successive `push()` calls.
 *
 * Inspired by claw-code's Rust `SseParser`: push a chunk in, get complete
 * frames out, with proper `\n\n` / `\r\n\r\n` boundary detection.
 *
 * @module sse-frame-parser
 */

/** A single parsed SSE frame. */
export interface SseFrame {
	/** Event type — empty string when no `event:` line is present. */
	event: string;
	/** Joined data lines (without the `data: ` prefix). */
	data: string;
}

/**
 * Stateful, push-based SSE frame parser. No async, no dependencies.
 *
 * I accumulate raw text via `push()`, detect frame boundaries (blank lines),
 * and return fully parsed `SseFrame` objects. Any incomplete trailing data
 * stays buffered until the next push or an explicit `flush()`.
 */
export class SseFrameParser {
	/** I hold unconsumed text that hasn't formed a complete frame yet. */
	private buf = "";

	/**
	 * Feed a chunk of text into the parser.
	 *
	 * I append the chunk to my internal buffer, split on frame boundaries
	 * (`\n\n`, `\r\n\r\n`, or mixed), parse each complete frame, and return
	 * the results. Incomplete trailing data stays in the buffer.
	 */
	push(chunk: string): SseFrame[] {
		this.buf += chunk;

		// Split on one or more consecutive blank lines (handles \n\n, \r\n\r\n, \r\n\n).
		const segments = this.buf.split(/\r?\n\r?\n/);

		// Last segment is either empty (frame ended cleanly) or an incomplete frame.
		this.buf = segments.pop() ?? "";

		const frames: SseFrame[] = [];
		for (const seg of segments) {
			const frame = this.parseSegment(seg);
			if (frame) frames.push(frame);
		}
		return frames;
	}

	/**
	 * Flush any remaining buffered content as a final frame.
	 *
	 * I call this when the stream ends so that a frame not terminated by a
	 * trailing blank line is still emitted.
	 */
	flush(): SseFrame[] {
		if (!this.buf.trim()) {
			this.buf = "";
			return [];
		}
		const frame = this.parseSegment(this.buf);
		this.buf = "";
		return frame ? [frame] : [];
	}

	/** Clear all internal state so I can be reused for a new stream. */
	reset(): void {
		this.buf = "";
	}

	/**
	 * Parse a single raw frame segment into an `SseFrame`.
	 *
	 * I walk each line, collect `event:` and `data:` fields per the SSE spec,
	 * and skip comments (`:` prefix) and unsupported fields (`id:`, `retry:`).
	 * Returns `null` if the segment contains no data.
	 */
	private parseSegment(raw: string): SseFrame | null {
		let event = "";
		const dataLines: string[] = [];

		for (const rawLine of raw.split(/\r?\n/)) {
			const line = rawLine;

			// Comment lines — skip per SSE spec.
			if (line.startsWith(":")) continue;

			if (line.startsWith("event:")) {
				event = line.slice(6).trimStart();
			} else if (line.startsWith("data:")) {
				dataLines.push(line.slice(5).trimStart());
			}
			// id: and retry: are intentionally ignored for now.
		}

		if (dataLines.length === 0 && !event) return null;
		return { event, data: dataLines.join("\n") };
	}
}

/**
 * Async generator that wraps a `ReadableStream<Uint8Array>` and yields
 * parsed SSE frames. I wire up a `TextDecoder` and `SseFrameParser`
 * internally so the consumer gets clean `SseFrame` objects.
 */
export async function* parseSseStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
	const decoder = new TextDecoder();
	const parser = new SseFrameParser();
	const reader = stream.getReader();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			for (const frame of parser.push(decoder.decode(value, { stream: true }))) yield frame;
		}
		for (const frame of parser.flush()) yield frame;
	} finally {
		reader.releaseLock();
	}
}
