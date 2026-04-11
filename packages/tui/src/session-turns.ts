import type { Message } from "@takumi/core";

export function countSessionTurns(messages: readonly Message[]): number {
	let turns = 0;
	for (const message of messages) {
		if (message.role === "user") {
			turns++;
		}
	}
	return turns;
}
