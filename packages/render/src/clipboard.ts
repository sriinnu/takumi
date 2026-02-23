/**
 * OSC 52 clipboard integration.
 * Provides copy/paste support via terminal escape sequences.
 *
 * OSC 52 is widely supported by modern terminals:
 *   iTerm2, kitty, alacritty, WezTerm, tmux (with set-clipboard on),
 *   Windows Terminal, foot, xterm, and more.
 *
 * Protocol:
 *   Copy:  \x1b]52;c;<base64-content>\x07
 *   Paste: \x1b]52;c;?\x07   (request clipboard contents)
 *   Response: \x1b]52;c;<base64-content>\x07  or  \x1b]52;c;<base64-content>\x1b\\
 */

/**
 * Generate an OSC 52 escape sequence to copy text to the system clipboard.
 *
 * @param text - The text to copy
 * @param target - Clipboard target: "c" for clipboard (default), "p" for primary selection
 * @returns The escape sequence string to write to the terminal
 */
export function copyToClipboard(text: string, target: "c" | "p" = "c"): string {
	const encoded = Buffer.from(text, "utf-8").toString("base64");
	return `\x1b]52;${target};${encoded}\x07`;
}

/**
 * Generate an OSC 52 escape sequence to request clipboard contents.
 * The terminal will respond with the clipboard content in an OSC 52 response.
 *
 * @param target - Clipboard target: "c" for clipboard (default), "p" for primary selection
 * @returns The escape sequence string to write to the terminal
 */
export function requestClipboard(target: "c" | "p" = "c"): string {
	return `\x1b]52;${target};?\x07`;
}

/**
 * Parse an OSC 52 clipboard response from the terminal.
 * The terminal sends back clipboard content as base64-encoded data.
 *
 * Supports both BEL (\x07) and ST (\x1b\\) terminators.
 *
 * @param data - The raw data received from the terminal
 * @returns The decoded clipboard text, or null if the data is not a valid OSC 52 response
 */
export function parseClipboardResponse(data: string): string | null {
	// Match OSC 52 response: \x1b]52;{target};{base64}\x07  or  \x1b]52;{target};{base64}\x1b\\
	const match = data.match(/\x1b\]52;[cp];([A-Za-z0-9+/=]*)(?:\x07|\x1b\\)/);
	if (!match) return null;

	const base64Content = match[1];
	if (base64Content === undefined) return null;

	try {
		return Buffer.from(base64Content, "base64").toString("utf-8");
	} catch {
		return null;
	}
}

/**
 * Generate an OSC 52 escape sequence to clear the clipboard.
 *
 * @param target - Clipboard target: "c" for clipboard (default), "p" for primary selection
 * @returns The escape sequence string to write to the terminal
 */
export function clearClipboard(target: "c" | "p" = "c"): string {
	return `\x1b]52;${target};\x07`;
}
