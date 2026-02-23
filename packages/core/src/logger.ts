import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LOG_LEVELS: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
	silent: 4,
};

let globalLevel: LogLevel = "info";

/** Set the global log level for all loggers. */
export function setLogLevel(level: LogLevel): void {
	globalLevel = level;
}

/** Get the log directory path, creating it if necessary. */
function getLogDir(): string {
	const dir = join(homedir(), ".takumi", "logs");
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return dir;
}

/** Format a log entry as a single line. */
function formatEntry(level: string, name: string, message: string, data?: unknown): string {
	const ts = new Date().toISOString();
	const base = `${ts} [${level.toUpperCase().padEnd(5)}] [${name}] ${message}`;
	if (data !== undefined) {
		return `${base} ${JSON.stringify(data)}\n`;
	}
	return `${base}\n`;
}

export interface Logger {
	debug(message: string, data?: unknown): void;
	info(message: string, data?: unknown): void;
	warn(message: string, data?: unknown): void;
	error(message: string, data?: unknown): void;
}

/**
 * Create a named logger that writes to ~/.takumi/logs/.
 * Output goes ONLY to files, never to stdout/stderr, to avoid
 * corrupting the TUI output.
 */
export function createLogger(name: string): Logger {
	const logDir = getLogDir();
	const date = new Date().toISOString().slice(0, 10);
	const logFile = join(logDir, `takumi-${date}.log`);

	function write(level: LogLevel, message: string, data?: unknown): void {
		if (LOG_LEVELS[level] < LOG_LEVELS[globalLevel]) return;
		const entry = formatEntry(level, name, message, data);
		try {
			appendFileSync(logFile, entry);
		} catch {
			// Silently ignore write failures — we never corrupt the TUI
		}
	}

	return {
		debug(message: string, data?: unknown) {
			write("debug", message, data);
		},
		info(message: string, data?: unknown) {
			write("info", message, data);
		},
		warn(message: string, data?: unknown) {
			write("warn", message, data);
		},
		error(message: string, data?: unknown) {
			write("error", message, data);
		},
	};
}
