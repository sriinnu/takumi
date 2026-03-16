/**
 * @file ws-transport.ts
 * @module ws-transport
 *
 * Lightweight WebSocket transport layer for embedding Takumi as a service.
 *
 * Uses Node built-in `node:http` and `node:crypto` for the upgrade handshake
 * and frame parsing — no external WebSocket library required.
 *
 * Designed for the Codex-style embedding use-case where a parent process
 * communicates with Takumi over a persistent bidirectional channel.
 */

import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";
import { createLogger } from "@takumi/core";

const log = createLogger("ws-transport");

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WsTransportConfig {
	port: number;
	host?: string;
	bearerToken?: string;
	onMessage?: (data: string) => void | Promise<void>;
	onClose?: () => void;
}

export interface WsTransportServer {
	start(): Promise<void>;
	stop(): Promise<void>;
	send(data: string): void;
	readonly connected: boolean;
}

// ─── WS Constants ────────────────────────────────────────────────────────────

const WS_MAGIC = "258EAFA5-E914-47DA-95CA-5AB53AB35613";
const OPCODE_TEXT = 0x01;
const OPCODE_CLOSE = 0x08;
const OPCODE_PING = 0x09;
const OPCODE_PONG = 0x0a;

// ─── Frame helpers ───────────────────────────────────────────────────────────

function buildFrame(opcode: number, payload: Buffer): Buffer {
	const len = payload.length;
	let header: Buffer;
	if (len < 126) {
		header = Buffer.alloc(2);
		header[0] = 0x80 | opcode;
		header[1] = len;
	} else if (len < 65536) {
		header = Buffer.alloc(4);
		header[0] = 0x80 | opcode;
		header[1] = 126;
		header.writeUInt16BE(len, 2);
	} else {
		header = Buffer.alloc(10);
		header[0] = 0x80 | opcode;
		header[1] = 127;
		header.writeBigUInt64BE(BigInt(len), 2);
	}
	return Buffer.concat([header, payload]);
}

// ─── Server ──────────────────────────────────────────────────────────────────

export function createWsTransport(config: WsTransportConfig): WsTransportServer {
	let server: Server | null = null;
	let activeSocket: Duplex | null = null;

	function handleUpgrade(req: IncomingMessage, socket: Duplex) {
		// Auth check
		if (config.bearerToken) {
			const authHeader = req.headers.authorization;
			if (!authHeader || authHeader !== `Bearer ${config.bearerToken}`) {
				socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
				socket.destroy();
				return;
			}
		}

		const key = req.headers["sec-websocket-key"];
		if (!key) {
			socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
			socket.destroy();
			return;
		}

		const accept = createHash("sha1")
			.update(key + WS_MAGIC)
			.digest("base64");
		socket.write(
			"HTTP/1.1 101 Switching Protocols\r\n" +
				"Upgrade: websocket\r\n" +
				"Connection: Upgrade\r\n" +
				`Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
		);

		// Only one client at a time
		if (activeSocket) {
			activeSocket.destroy();
		}
		activeSocket = socket;

		let buf: Buffer = Buffer.alloc(0) as Buffer;

		socket.on("data", (chunk: Buffer) => {
			buf = Buffer.concat([buf, chunk]) as Buffer;
			while (buf.length >= 2) {
				const parsed = parseFrame(buf);
				if (!parsed) break;
				buf = parsed.rest;
				handleFrame(parsed.opcode, parsed.payload, socket);
			}
		});

		socket.on("close", () => {
			if (activeSocket === socket) activeSocket = null;
			config.onClose?.();
		});
		socket.on("error", () => {
			if (activeSocket === socket) activeSocket = null;
		});
	}

	function parseFrame(buf: Buffer): { opcode: number; payload: Buffer; rest: Buffer } | null {
		if (buf.length < 2) return null;
		const opcode = buf[0] & 0x0f;
		const masked = (buf[1] & 0x80) !== 0;
		let payloadLen = buf[1] & 0x7f;
		let offset = 2;

		if (payloadLen === 126) {
			if (buf.length < 4) return null;
			payloadLen = buf.readUInt16BE(2);
			offset = 4;
		} else if (payloadLen === 127) {
			if (buf.length < 10) return null;
			payloadLen = Number(buf.readBigUInt64BE(2));
			offset = 10;
		}

		const maskSize = masked ? 4 : 0;
		const total = offset + maskSize + payloadLen;
		if (buf.length < total) return null;

		let payload: Buffer;
		if (masked) {
			const mask = buf.subarray(offset, offset + 4);
			payload = Buffer.alloc(payloadLen);
			for (let i = 0; i < payloadLen; i++) {
				payload[i] = buf[offset + 4 + i] ^ mask[i % 4];
			}
		} else {
			payload = buf.subarray(offset, offset + payloadLen);
		}

		return { opcode, payload, rest: buf.subarray(total) };
	}

	function handleFrame(opcode: number, payload: Buffer, socket: Duplex) {
		if (opcode === OPCODE_TEXT) {
			const text = payload.toString("utf-8");
			void Promise.resolve(config.onMessage?.(text)).catch((err) =>
				log.error(`WS message handler error: ${(err as Error).message}`),
			);
		} else if (opcode === OPCODE_PING) {
			socket.write(buildFrame(OPCODE_PONG, payload));
		} else if (opcode === OPCODE_CLOSE) {
			socket.write(buildFrame(OPCODE_CLOSE, Buffer.alloc(0)));
			socket.end();
		}
	}

	return {
		async start() {
			server = createServer((_req, res) => {
				res.writeHead(426);
				res.end("WebSocket required");
			});
			server.on("upgrade", (req, socket) => handleUpgrade(req, socket as Duplex));
			await new Promise<void>((resolve) => {
				server!.listen(config.port, config.host ?? "127.0.0.1", resolve);
			});
			log.info(`WS transport listening on ${config.host ?? "127.0.0.1"}:${config.port}`);
		},
		async stop() {
			activeSocket?.destroy();
			activeSocket = null;
			if (server) {
				await new Promise<void>((resolve) => server!.close(() => resolve()));
				server = null;
			}
		},
		send(data: string) {
			if (activeSocket && !activeSocket.destroyed) {
				activeSocket.write(buildFrame(OPCODE_TEXT, Buffer.from(data, "utf-8")));
			}
		},
		get connected() {
			return activeSocket !== null && !activeSocket.destroyed;
		},
	};
}
