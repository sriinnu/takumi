import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { registerImageCommands } from "../src/commands/app-commands-image.js";
import { SlashCommandRegistry } from "../src/commands/commands.js";
import { AppState } from "../src/state.js";

function createContext() {
	const commands = new SlashCommandRegistry();
	const state = new AppState();
	const addInfoMessage = vi.fn();
	const submit = vi.fn(async () => undefined);

	registerImageCommands({
		commands,
		state,
		agentRunner: { submit } as never,
		config: { workingDirectory: process.cwd() } as never,
		autoPr: false,
		autoShip: false,
		addInfoMessage,
		buildSessionData: vi.fn() as never,
		startAutoSaver: vi.fn(),
		quit: vi.fn().mockResolvedValue(undefined),
		getActiveCoder: vi.fn().mockReturnValue(null),
		setActiveCoder: vi.fn(),
		getActiveAutocycle: vi.fn().mockReturnValue(null),
		setActiveAutocycle: vi.fn(),
	} as never);

	return { commands, state, addInfoMessage, submit };
}

describe("/image command", () => {
	it("attaches an image file and submits a multimodal turn", async () => {
		const { commands, state, submit } = createContext();
		const filePath = join(tmpdir(), `takumi-image-${Date.now()}.png`);
		await writeFile(filePath, Buffer.from("fake-png-data"));

		await commands.execute(`/image ${filePath} Inspect this screenshot`);

		expect(state.messages.value).toHaveLength(1);
		expect(state.messages.value[0]?.content).toEqual([
			expect.objectContaining({ type: "text", text: "Inspect this screenshot" }),
			expect.objectContaining({ type: "image", mediaType: "image/png" }),
		]);
		expect(submit).toHaveBeenCalledWith("Inspect this screenshot", {
			images: [expect.objectContaining({ mediaType: "image/png" })],
		});
	});

	it("accepts image data urls", async () => {
		const { commands, state, submit } = createContext();
		const dataUrl = "data:image/png;base64,aGVsbG8=";

		await commands.execute(`/image ${dataUrl} Explain this chart`);

		expect(state.messages.value[0]?.content[1]).toEqual(
			expect.objectContaining({ type: "image", mediaType: "image/png", data: "aGVsbG8=" }),
		);
		expect(submit).toHaveBeenCalledWith("Explain this chart", {
			images: [{ mediaType: "image/png", data: "aGVsbG8=" }],
		});
	});
});
