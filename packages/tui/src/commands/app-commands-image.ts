import type { Message } from "@takumi/core";
import { loadImageAttachment, parseLeadingArgument } from "../image-attachments.js";
import type { AppCommandContext } from "./app-command-context.js";

export function registerImageCommands(ctx: AppCommandContext): void {
	ctx.commands.register(
		"/image",
		"Attach an image from a file or data URL and submit it with an optional prompt",
		async (args) => {
			const { value: source, rest } = parseLeadingArgument(args);
			if (!source || source === "help") {
				ctx.addInfoMessage(
					"Usage: /image <path-or-data-url> [prompt]\nExample: /image screenshots/bug.png Describe the UI issue",
				);
				return;
			}

			if (!ctx.agentRunner) {
				ctx.addInfoMessage("No agent runner is active — unable to submit image input right now");
				return;
			}

			try {
				const attachment = await loadImageAttachment(source, ctx.config.workingDirectory || process.cwd());
				const text = rest || "Please analyze this image.";
				const message: Message = {
					id: `msg-${Date.now()}`,
					role: "user",
					content: [
						{ type: "text", text },
						{ type: "image", mediaType: attachment.mediaType, data: attachment.data },
					],
					timestamp: Date.now(),
				};

				ctx.state.addMessage(message);
				ctx.state.turnCount.value++;
				await ctx.agentRunner.submit(text, {
					images: [{ mediaType: attachment.mediaType, data: attachment.data }],
				});
			} catch (err) {
				ctx.addInfoMessage(`Failed to attach image: ${(err as Error).message}`);
			}
		},
		["/img"],
	);
}
