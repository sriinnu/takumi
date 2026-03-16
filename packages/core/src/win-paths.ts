/**
 * Windows and WSL path translation utilities.
 *
 * Handles conversion between Windows (C:\Users\...)  and WSL (/mnt/c/Users/...)
 * path formats, and resolves correct executable names per platform.
 *
 * @module
 */

import { IS_WINDOWS, isWSL } from "./platform-detect.js";

// ── Path translation ──────────────────────────────────────────────────────────

const WIN_DRIVE_RE = /^([a-zA-Z]):[/\\]/;
const WSL_MNT_RE = /^\/mnt\/([a-zA-Z])\//;

/**
 * Convert a Windows path to its WSL equivalent.
 *   `C:\Users\foo\bar` → `/mnt/c/Users/foo/bar`
 *   `C:/Users/foo/bar`  → `/mnt/c/Users/foo/bar`
 */
export function winToWslPath(winPath: string): string {
	if (!WIN_DRIVE_RE.test(winPath)) return winPath;
	return winPath.replace(WIN_DRIVE_RE, (_m, drive: string) => `/mnt/${drive.toLowerCase()}/`).replace(/\\/g, "/");
}

/**
 * Convert a WSL path back to its Windows equivalent.
 *   `/mnt/c/Users/foo/bar` → `C:\Users\foo\bar`
 * Non-WSL POSIX paths are returned unchanged.
 */
export function wslToWinPath(wslPath: string): string {
	if (!WSL_MNT_RE.test(wslPath)) return wslPath;
	return wslPath.replace(WSL_MNT_RE, (_m, drive: string) => `${drive.toUpperCase()}:\\`).replace(/\//g, "\\");
}

/**
 * Normalise a path for the current environment.
 * On WSL, Windows paths are translated; on native Windows, WSL paths are translated back.
 * On other platforms, the path is returned unchanged.
 */
export function normalisePath(p: string): string {
	if (isWSL() && WIN_DRIVE_RE.test(p)) return winToWslPath(p);
	if (IS_WINDOWS && WSL_MNT_RE.test(p)) return wslToWinPath(p);
	return p;
}

// ── Executable name resolution ────────────────────────────────────────────────

/**
 * Append `.cmd` suffix on Windows for npm/pnpm/yarn executables,
 * since Windows requires the `.cmd` wrapper.
 */
export function resolveExeName(name: string): string {
	if (!IS_WINDOWS) return name;

	const needsSuffix = ["pnpm", "npm", "yarn", "npx", "tsc", "biome", "vitest"];
	if (needsSuffix.includes(name)) return `${name}.cmd`;

	return name;
}
