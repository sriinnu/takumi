import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { DaemonSocketClient } from "@takumi/bridge";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createHandshakeServer(response: Record<string, unknown>): Promise<{
	socketPath: string;
	close(): Promise<void>;
}> {
	const dir = await mkdtemp(path.join(tmpdir(), "takumi-daemon-socket-auth-"));
	tempDirs.push(dir);
	const socketPath = path.join(dir, "chitragupta.sock");
	const server = createServer((socket) => {
		let buffer = "";
		socket.setEncoding("utf-8");
		socket.on("data", (chunk: string) => {
			buffer += chunk;
			let newlineIndex = buffer.indexOf("\n");
			while (newlineIndex !== -1) {
				const line = buffer.slice(0, newlineIndex).trim();
				buffer = buffer.slice(newlineIndex + 1);
				if (line) {
					const message = JSON.parse(line) as { id?: string; method?: string };
					if (message.id && message.method === "auth.handshake") {
						socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: response })}\n`);
					}
				}
				newlineIndex = buffer.indexOf("\n");
			}
		});
	});

	server.listen(socketPath);
	await once(server, "listening");
	return {
		socketPath,
		close: async () => {
			server.close();
			await once(server, "close");
		},
	};
}

describe("DaemonSocketClient auth handshake", () => {
	it("fails fast when no daemon bridge token is available", async () => {
		const server = await createHandshakeServer({ authenticated: true });
		const originalPath = process.env.CHITRAGUPTA_DAEMON_API_KEY_PATH;
		const originalToken = process.env.CHITRAGUPTA_DAEMON_API_KEY;
		process.env.CHITRAGUPTA_DAEMON_API_KEY_PATH = path.join(path.dirname(server.socketPath), "missing-token");
		delete process.env.CHITRAGUPTA_DAEMON_API_KEY;

		try {
			const client = new DaemonSocketClient(server.socketPath, 1_000);
			await expect(client.connect()).rejects.toThrow("Missing daemon bridge token for auth.handshake");
		} finally {
			if (originalPath == null) delete process.env.CHITRAGUPTA_DAEMON_API_KEY_PATH;
			else process.env.CHITRAGUPTA_DAEMON_API_KEY_PATH = originalPath;
			if (originalToken == null) delete process.env.CHITRAGUPTA_DAEMON_API_KEY;
			else process.env.CHITRAGUPTA_DAEMON_API_KEY = originalToken;
			await server.close();
		}
	});

	it("surfaces daemon-auth rejection detail from auth.handshake", async () => {
		const server = await createHandshakeServer({ authenticated: false, error: "invalid key" });

		try {
			const client = new DaemonSocketClient(server.socketPath, 1_000, "chg_0123456789abcdef0123456789abcdef");
			await expect(client.connect()).rejects.toThrow("Daemon bridge authentication failed: invalid key");
		} finally {
			await server.close();
		}
	});
});
