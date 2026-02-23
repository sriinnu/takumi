/**
 * PermissionDialog — modal for tool permission approval.
 * Shows tool name, args preview, and allow/deny/always-allow options.
 * Pure logic/state class — no rendering.
 */

import type { KeyEvent } from "@takumi/core";
import { KEY_CODES } from "@takumi/core";
import type { Signal } from "@takumi/render";
import { signal } from "@takumi/render";

export interface PermissionResponse {
	allowed: boolean;
	remember: boolean;
}

export class PermissionDialog {
	private readonly _isOpen: Signal<boolean> = signal(false);
	private readonly _toolName: Signal<string> = signal("");
	private readonly _argsPreview: Signal<string> = signal("");
	private _resolve: ((response: PermissionResponse) => void) | null = null;

	/**
	 * Show the permission dialog for a tool invocation.
	 * Returns a promise that resolves when the user responds.
	 */
	show(tool: string, args: Record<string, unknown>): Promise<PermissionResponse> {
		this._toolName.value = tool;
		this._argsPreview.value = truncateArgs(args, 200);
		this._isOpen.value = true;

		return new Promise<PermissionResponse>((resolve) => {
			this._resolve = resolve;
		});
	}

	/** Process a key event. Returns true if the event was consumed. */
	handleKey(event: KeyEvent): boolean {
		if (!this._isOpen.value) return false;

		// y or Enter = Allow once
		if (event.key === "y" || event.raw === KEY_CODES.ENTER) {
			this.respond({ allowed: true, remember: false });
			return true;
		}

		// a = Always allow
		if (event.key === "a") {
			this.respond({ allowed: true, remember: true });
			return true;
		}

		// n or Escape = Deny
		if (event.key === "n" || event.raw === KEY_CODES.ESCAPE) {
			this.respond({ allowed: false, remember: false });
			return true;
		}

		return true; // Consume all keys while open
	}

	/** Resolve the pending promise and close the dialog. */
	private respond(response: PermissionResponse): void {
		this._isOpen.value = false;
		const resolve = this._resolve;
		this._resolve = null;
		resolve?.(response);
	}

	get isOpen(): boolean {
		return this._isOpen.value;
	}

	get toolName(): string {
		return this._toolName.value;
	}

	get argsPreview(): string {
		return this._argsPreview.value;
	}
}

/** Truncate a JSON representation of args to maxLen characters. */
function truncateArgs(args: Record<string, unknown>, maxLen: number): string {
	const json = JSON.stringify(args, null, 2);
	if (json.length <= maxLen) return json;
	return `${json.slice(0, maxLen)}...`;
}
