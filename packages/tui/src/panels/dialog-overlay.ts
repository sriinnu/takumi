/**
 * DialogOverlay — modal layer for command palette, model picker, session list,
 * and permission prompts.
 *
 * This bridges existing logic-only dialog classes into actual rendered overlays.
 */

import { KEY_CODES, type KeyEvent, listSessions, type Rect } from "@takumi/core";
import type { Screen } from "@takumi/render";
import { Component, effect } from "@takumi/render";
import type { SlashCommandRegistry } from "../commands/commands.js";
import { CommandPalette } from "../dialogs/command-palette.js";
import { ExtensionPromptDialog } from "../dialogs/extension-prompt.js";
import { ModelPicker } from "../dialogs/model-picker.js";
import { type SessionEntry, SessionList } from "../dialogs/session-list.js";
import type { ExtensionUiStore } from "../extension-ui-store.js";
import type { KeyBindingRegistry } from "../input/keybinds.js";
import type { AppState } from "../state.js";
import { buildCommandPaletteDialogModel } from "./dialog-overlay-command-palette.js";

export interface DialogOverlayProps {
	state: AppState;
	commands?: SlashCommandRegistry;
	keybinds?: KeyBindingRegistry;
	extensionUiStore?: ExtensionUiStore;
	onResumeSession?: (sessionId: string) => Promise<void> | void;
}

export class DialogOverlay extends Component {
	private readonly state: AppState;
	private readonly commands: SlashCommandRegistry | null;
	private readonly keybinds: KeyBindingRegistry | null;
	private readonly extensionUiStore: ExtensionUiStore | null;
	private readonly sessionList = new SessionList();
	private readonly modelPicker = new ModelPicker();
	private readonly extensionPrompt = new ExtensionPromptDialog();
	private readonly commandPalette: CommandPalette | null;
	private disposeEffects: Array<() => void> = [];
	private loadingSessions = false;
	private sessionListError: string | null = null;

	constructor(props: DialogOverlayProps) {
		super();
		this.state = props.state;
		this.commands = props.commands ?? null;
		this.keybinds = props.keybinds ?? null;
		this.extensionUiStore = props.extensionUiStore ?? null;
		this.commandPalette = this.commands && this.keybinds ? new CommandPalette(this.commands, this.keybinds) : null;

		this.modelPicker.onSelect = (model) => {
			this.state.model.value = model;
			this.state.popDialog();
		};
		this.sessionList.onSelect = async (sessionId) => {
			await props.onResumeSession?.(sessionId);
			if (this.state.topDialog === "session-list") {
				this.state.popDialog();
			}
		};
		if (this.commandPalette) {
			this.commandPalette.onExecute = (item) => {
				if (item.type === "keybind") {
					const binding = this.keybinds?.get(item.name);
					binding?.handler();
				}
				if (this.state.topDialog === "command-palette") {
					this.state.popDialog();
				}
			};
		}

		this.disposeEffects.push(
			effect(() => {
				const topDialog = this.state.topDialog;
				const provider = this.state.provider.value;
				const pendingPermission = this.state.pendingPermission.value;
				const extensionPrompt = this.extensionUiStore?.activePrompt.value ?? null;
				void pendingPermission;

				if (extensionPrompt) this.extensionPrompt.open(extensionPrompt);
				else this.extensionPrompt.close();

				if (topDialog === "model-picker") {
					const models = this.state.availableProviderModels.value[provider] ?? [this.state.model.value];
					this.modelPicker.setModels(
						models.includes(this.state.model.value) ? models : [this.state.model.value, ...models],
					);
					this.modelPicker.close();
					this.modelPicker.open();
				} else {
					this.modelPicker.close();
				}

				if (topDialog === "command-palette") {
					this.commandPalette?.open();
				} else {
					this.commandPalette?.close();
				}

				if (topDialog === "session-list" && !this.loadingSessions) {
					this.sessionListError = null;
					this.loadingSessions = true;
					void this.loadMergedSessionList()
						.then((entries) => {
							if (this.state.topDialog === "session-list") {
								this.sessionList.open(entries);
								this.markDirty();
							}
						})
						.catch((err) => {
							this.sessionListError = (err as Error).message;
							if (this.state.topDialog === "session-list") {
								this.sessionList.close();
								this.markDirty();
							}
						})
						.finally(() => {
							this.loadingSessions = false;
						});
				} else if (topDialog !== "session-list") {
					this.sessionListError = null;
					this.sessionList.close();
				}

				this.markDirty();
				return undefined;
			}),
		);
	}

	onUnmount(): void {
		for (const dispose of this.disposeEffects) dispose();
		this.disposeEffects = [];
		super.onUnmount();
	}

	get active(): boolean {
		return Boolean(this.state.pendingPermission.value || this.extensionPrompt.isOpen || this.state.topDialog);
	}

	handleKey(event: KeyEvent): boolean {
		const pending = this.state.pendingPermission.value;
		if (pending) {
			if (event.key === "y" || event.raw === KEY_CODES.ENTER) {
				pending.resolve({ allowed: true });
				this.state.pendingPermission.value = null;
				if (this.state.topDialog === "permission") this.state.popDialog();
				this.markDirty();
				return true;
			}
			if (event.key === "a") {
				pending.resolve({ allowed: true });
				this.state.pendingPermission.value = null;
				if (this.state.topDialog === "permission") this.state.popDialog();
				this.markDirty();
				return true;
			}
			if (event.key === "n" || event.raw === KEY_CODES.ESCAPE) {
				pending.resolve({ allowed: false });
				this.state.pendingPermission.value = null;
				if (this.state.topDialog === "permission") this.state.popDialog();
				this.markDirty();
				return true;
			}
			return true;
		}

		if (this.extensionPrompt.isOpen) {
			const outcome = this.extensionPrompt.handleKey(event);
			if (outcome.kind === "resolve") {
				this.extensionUiStore?.resolveActivePrompt(outcome.value);
			} else if (outcome.kind === "cancel") {
				this.extensionUiStore?.cancelActivePrompt();
			}
			this.markDirty();
			return true;
		}

		const topDialog = this.state.topDialog;
		if (topDialog === "command-palette" && this.commandPalette) {
			const consumed = this.commandPalette.handleKey(event);
			if (!this.commandPalette.isOpen && this.state.topDialog === "command-palette") this.state.popDialog();
			this.markDirty();
			return consumed;
		}
		if (topDialog === "model-picker") {
			const consumed = this.modelPicker.handleKey(event);
			if (!this.modelPicker.isOpen && this.state.topDialog === "model-picker") this.state.popDialog();
			this.markDirty();
			return consumed;
		}
		if (topDialog === "session-list") {
			if (this.loadingSessions && !this.sessionList.isOpen) {
				this.markDirty();
				return true;
			}
			const consumed = this.sessionList.handleKey(event);
			if (!this.sessionList.isOpen && this.state.topDialog === "session-list") this.state.popDialog();
			this.markDirty();
			return consumed;
		}
		return false;
	}

	render(screen: Screen, rect: Rect): void {
		if (!this.active) return;
		for (let y = rect.y; y < rect.y + rect.height; y++) {
			for (let x = rect.x; x < rect.x + rect.width; x++) {
				screen.set(y, x, {
					char: " ",
					fg: 7,
					bg: 235,
					bold: false,
					dim: true,
					italic: false,
					underline: false,
					strikethrough: false,
				});
			}
		}

		const pending = this.state.pendingPermission.value;
		if (pending) {
			this.renderPermission(screen, rect, pending.tool, JSON.stringify(pending.args, null, 2));
			return;
		}
		if (this.extensionPrompt.isOpen) {
			this.renderExtensionPrompt(screen, rect);
			return;
		}

		switch (this.state.topDialog) {
			case "command-palette":
				if (this.commandPalette) this.renderCommandPalette(screen, rect);
				break;
			case "model-picker":
				this.renderModelPicker(screen, rect);
				break;
			case "session-list":
				this.renderSessionList(screen, rect);
				break;
		}
	}

	private async loadMergedSessionList(): Promise<SessionEntry[]> {
		const localSessions = await listSessions(20);
		const localEntries: SessionEntry[] = localSessions.map((session) => ({
			id: session.id,
			date: new Date(session.updatedAt).toLocaleString(),
			turns: session.messageCount,
			preview: session.title,
			sortKey: session.updatedAt,
		}));

		const bridge = this.state.chitraguptaBridge.value;
		if (!bridge?.isConnected) return localEntries;

		try {
			const daemonSessions = await bridge.sessionList(20);
			const localIds = new Set(localEntries.map((e) => e.id));
			const daemonEntries: SessionEntry[] = daemonSessions
				.filter((ds) => !localIds.has(ds.id))
				.map((ds) => ({
					id: ds.id,
					date: new Date(ds.timestamp).toLocaleString(),
					turns: ds.turns,
					preview: `[daemon] ${ds.title}`,
					sortKey: ds.timestamp,
				}));
			return [...localEntries, ...daemonEntries].sort((a, b) => (b.sortKey ?? 0) - (a.sortKey ?? 0)).slice(0, 20);
		} catch {
			return localEntries;
		}
	}

	private renderPermission(screen: Screen, rect: Rect, tool: string, args: string): void {
		const lines = [
			`Tool permission: ${tool}`,
			args.length > 80 ? `${args.slice(0, 80)}…` : args,
			"",
			"Enter/y = allow   a = allow   n/Esc = deny",
		];
		this.renderBox(screen, rect, "Permission", lines, 72);
	}

	private renderCommandPalette(screen: Screen, rect: Rect): void {
		const palette = this.commandPalette;
		if (!palette) return;
		const model = buildCommandPaletteDialogModel(palette);
		this.renderBox(screen, rect, model.title, model.lines, model.maxWidth);
	}

	private renderModelPicker(screen: Screen, rect: Rect): void {
		const models = this.modelPicker.getModels().slice(0, 10);
		const lines = [
			`Provider: ${this.state.provider.value}`,
			"",
			...models.map((model, index) => `${index === this.modelPicker.selectedIndex ? ">" : " "} ${model}`),
			"",
			"Enter = select   Esc = close",
		];
		this.renderBox(screen, rect, "Model Picker", lines, 88);
	}

	private renderSessionList(screen: Screen, rect: Rect): void {
		const sessions = this.sessionList.getSessions();
		const lines = this.sessionListError
			? [`Session list failed: ${this.sessionListError}`]
			: sessions.length === 0
				? [this.loadingSessions ? "Loading sessions…" : "No saved sessions found."]
				: sessions.slice(0, 8).map((session, index) => {
						const marker = index === this.sessionList.selectedIndex ? ">" : " ";
						return `${marker} ${session.id} — ${session.preview}`;
					});
		this.renderBox(screen, rect, "Sessions", lines, 96);
	}

	private renderExtensionPrompt(screen: Screen, rect: Rect): void {
		const prompt = this.extensionPrompt.prompt;
		if (!prompt) return;
		if (prompt.kind === "confirm") {
			this.renderBox(
				screen,
				rect,
				prompt.title ?? "Confirm",
				[prompt.message, "", "Enter/y = confirm   n/Esc = cancel"],
				88,
			);
			return;
		}
		const { items, offset } = this.extensionPrompt.getPickWindow();
		const lines = [
			prompt.message,
			`Filter: ${this.extensionPrompt.filterText || "(type to narrow)"}`,
			"",
			...(items.length === 0
				? ["(no matches)"]
				: items.map((item, index) => {
						const absoluteIndex = offset + index;
						const marker = absoluteIndex === this.extensionPrompt.selectedIndex ? ">" : " ";
						const detail = item.description ? ` — ${item.description}` : "";
						return `${marker} ${item.label}${detail}`;
					})),
			"",
			"↑/↓ or j/k = move   Enter = select   Esc = cancel",
		];
		this.renderBox(screen, rect, prompt.title ?? "Select", lines, 96);
	}

	private renderBox(screen: Screen, rect: Rect, title: string, lines: string[], maxWidth: number): void {
		const width = Math.min(maxWidth, Math.max(40, Math.floor(rect.width * 0.7)));
		const height = Math.min(rect.height - 4, Math.max(6, lines.length + 2));
		const x = rect.x + Math.floor((rect.width - width) / 2);
		const y = rect.y + Math.floor((rect.height - height) / 2);
		const innerWidth = width - 2;

		for (let row = 0; row < height; row++) {
			for (let col = 0; col < width; col++) {
				const absY = y + row;
				const absX = x + col;
				const isTop = row === 0;
				const isBottom = row === height - 1;
				const isLeft = col === 0;
				const isRight = col === width - 1;
				const char =
					isTop && isLeft
						? "┌"
						: isTop && isRight
							? "┐"
							: isBottom && isLeft
								? "└"
								: isBottom && isRight
									? "┘"
									: isTop || isBottom
										? "─"
										: isLeft || isRight
											? "│"
											: " ";
				screen.set(absY, absX, {
					char,
					fg: isTop || isBottom || isLeft || isRight ? 141 : 7,
					bg: 236,
					bold: isTop,
					dim: false,
					italic: false,
					underline: false,
					strikethrough: false,
				});
			}
		}
		screen.writeText(y, x + 2, ` ${title} `, { fg: 15, bg: 236, bold: true });
		for (let index = 0; index < Math.min(lines.length, height - 2); index++) {
			const line = lines[index];
			screen.writeText(y + 1 + index, x + 1, this.trunc(line, innerWidth).padEnd(innerWidth), { fg: 7, bg: 236 });
		}
	}

	private trunc(text: string, width: number): string {
		if (text.length <= width) return text;
		return `${text.slice(0, width - 1)}…`;
	}
}
