/**
 * SessionListDialog — dialog for browsing and resuming past sessions.
 * Shows recent sessions with date, turn count, and preview.
 * Pure logic/state class — no rendering.
 */

import { signal } from "@takumi/render";
import type { Signal } from "@takumi/render";
import type { KeyEvent } from "@takumi/core";
import { KEY_CODES } from "@takumi/core";

export interface SessionEntry {
	id: string;
	date: string;
	turns: number;
	preview: string;
}

export class SessionList {
	private readonly _isOpen: Signal<boolean> = signal(false);
	private readonly _selectedIndex: Signal<number> = signal(0);
	private readonly _sessions: Signal<SessionEntry[]> = signal([]);

	/** Called when a session is selected for resume. */
	onSelect?: (sessionId: string) => void;

	constructor() {}

	/** Show the dialog with a list of sessions. */
	open(sessions: SessionEntry[]): void {
		this._sessions.value = sessions;
		this._selectedIndex.value = 0;
		this._isOpen.value = true;
	}

	/** Hide the dialog. */
	close(): void {
		this._isOpen.value = false;
	}

	/** Process a key event. Returns true if the event was consumed. */
	handleKey(event: KeyEvent): boolean {
		if (!this._isOpen.value) return false;

		// Escape closes
		if (event.raw === KEY_CODES.ESCAPE) {
			this.close();
			return true;
		}

		// Up arrow
		if (event.raw === KEY_CODES.UP) {
			const sessions = this._sessions.value;
			if (sessions.length > 0) {
				this._selectedIndex.value = Math.max(0, this._selectedIndex.value - 1);
			}
			return true;
		}

		// Down arrow
		if (event.raw === KEY_CODES.DOWN) {
			const sessions = this._sessions.value;
			if (sessions.length > 0) {
				this._selectedIndex.value = Math.min(sessions.length - 1, this._selectedIndex.value + 1);
			}
			return true;
		}

		// Enter — select session
		if (event.raw === KEY_CODES.ENTER) {
			const sessions = this._sessions.value;
			if (sessions.length > 0 && this._selectedIndex.value < sessions.length) {
				const session = sessions[this._selectedIndex.value];
				this.close();
				this.onSelect?.(session.id);
			}
			return true;
		}

		return true; // Consume all keys while open
	}

	/** Get the current sessions list. */
	getSessions(): SessionEntry[] {
		return this._sessions.value;
	}

	get selectedIndex(): number {
		return this._selectedIndex.value;
	}

	get isOpen(): boolean {
		return this._isOpen.value;
	}
}
