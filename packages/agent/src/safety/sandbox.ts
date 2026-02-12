/**
 * Command sandbox — validates shell commands against an allowlist
 * and blocks dangerous patterns.
 */

/** Commands that are safe to run without user permission. */
export const SAFE_COMMANDS = new Set([
	// Navigation & info
	"ls",
	"pwd",
	"whoami",
	"uname",
	"hostname",
	"date",
	"env",
	"printenv",
	"which",
	"type",
	"file",
	"wc",
	"du",
	"df",
	"stat",

	// File reading (no modification)
	"cat",
	"head",
	"tail",
	"less",
	"more",
	"diff",
	"md5sum",
	"sha256sum",

	// Search
	"find",
	"grep",
	"rg",
	"ag",
	"fd",
	"fzf",
	"locate",

	// Git (read operations)
	"git",

	// Node.js / package managers (read operations)
	"node",
	"npm",
	"npx",
	"pnpm",
	"yarn",
	"bun",
	"deno",
	"tsx",

	// Build tools
	"tsc",
	"esbuild",
	"vite",
	"vitest",
	"jest",
	"mocha",
	"biome",
	"eslint",
	"prettier",

	// System info
	"ps",
	"top",
	"htop",
	"free",
	"uptime",
	"lsof",
	"netstat",
	"ss",

	// Text processing
	"sort",
	"uniq",
	"tr",
	"cut",
	"paste",
	"column",
	"jq",
	"yq",
	"xargs",
	"sed",
	"awk",
	"perl",

	// Archive (read)
	"tar",
	"zip",
	"unzip",
	"gzip",
	"gunzip",

	// Network (read)
	"curl",
	"wget",
	"ping",
	"dig",
	"nslookup",
	"host",

	// Docker (read)
	"docker",
	"docker-compose",

	// Misc
	"echo",
	"printf",
	"true",
	"false",
	"test",
	"[",
	"expr",
	"bc",
	"basename",
	"dirname",
	"realpath",
	"readlink",
	"mkdir",
	"touch",
	"cp",
	"mv",
	"ln",
]);

/** Patterns that indicate dangerous commands. */
export const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
	{ pattern: /\brm\s+-[rf]*\s+\/(?!\w)/, reason: "Recursive delete from root" },
	{ pattern: /\brm\s+-[rf]*\s+~\//, reason: "Recursive delete from home" },
	{ pattern: /\bsudo\b/, reason: "sudo commands require explicit user permission" },
	{ pattern: /\bchmod\s+[0-7]*777\b/, reason: "Setting world-writable permissions" },
	{ pattern: /\bchown\b/, reason: "Changing file ownership" },
	{ pattern: /\bmkfs\b/, reason: "Filesystem creation" },
	{ pattern: /\bdd\b.*\bof=\/dev\//, reason: "Writing to block devices" },
	{ pattern: /\bformat\b/, reason: "Disk formatting" },
	{ pattern: /\bshutdown\b|\breboot\b|\bhalt\b|\bpoweroff\b/, reason: "System shutdown/reboot" },
	{ pattern: /\biptables\b|\bnft\b/, reason: "Firewall manipulation" },
	{ pattern: /\bsystemctl\s+(start|stop|restart|enable|disable)\b/, reason: "Service management" },
	{ pattern: />\s*\/dev\/sd[a-z]/, reason: "Writing to block devices" },
	{ pattern: /\beval\b.*\$\(/, reason: "eval with command substitution" },
	{ pattern: /;\s*rm\s/, reason: "Chained rm command" },
	{ pattern: /\|\s*sh\b|\|\s*bash\b/, reason: "Piping to shell" },
	{ pattern: /\bcurl\b.*\|\s*(sh|bash)\b/, reason: "Curl pipe to shell" },
	{ pattern: /\x0a|\x0d/, reason: "Newline injection in command" },
	{ pattern: /\bgit\s+push\s+.*--force\b/, reason: "Force push" },
	{ pattern: /\bgit\s+reset\s+--hard\b/, reason: "Hard reset" },
	{ pattern: /\bgit\s+clean\s+-f\b/, reason: "Git clean force" },
];

export interface ValidationResult {
	allowed: boolean;
	reason?: string;
}

/**
 * Validate a shell command against the allowlist and dangerous patterns.
 */
export function validateCommand(command: string): ValidationResult {
	if (!command || !command.trim()) {
		return { allowed: false, reason: "Empty command" };
	}

	// Check for dangerous patterns first
	for (const { pattern, reason } of DANGEROUS_PATTERNS) {
		if (pattern.test(command)) {
			return { allowed: false, reason };
		}
	}

	// Extract the base command (first word, ignoring env vars)
	const baseCommand = extractBaseCommand(command);

	if (!baseCommand) {
		return { allowed: false, reason: "Could not determine command" };
	}

	if (!SAFE_COMMANDS.has(baseCommand)) {
		return {
			allowed: false,
			reason: `Command '${baseCommand}' is not in the allowlist. Safe commands: ${[...SAFE_COMMANDS].slice(0, 20).join(", ")}...`,
		};
	}

	return { allowed: true };
}

/**
 * Extract the base command name from a command string,
 * handling env vars, paths, and pipes.
 */
function extractBaseCommand(command: string): string | null {
	// Strip leading environment variables (KEY=value ...)
	let cmd = command.trim();
	while (/^[A-Z_][A-Z0-9_]*=\S*\s/.test(cmd)) {
		cmd = cmd.replace(/^[A-Z_][A-Z0-9_]*=\S*\s+/, "");
	}

	// Handle pipes — validate the first command
	const pipeIndex = cmd.indexOf("|");
	if (pipeIndex !== -1) {
		cmd = cmd.slice(0, pipeIndex).trim();
	}

	// Handle semicolons — validate the first command
	const semiIndex = cmd.indexOf(";");
	if (semiIndex !== -1) {
		cmd = cmd.slice(0, semiIndex).trim();
	}

	// Handle && chains
	const andIndex = cmd.indexOf("&&");
	if (andIndex !== -1) {
		cmd = cmd.slice(0, andIndex).trim();
	}

	// Get the first word (the command name)
	const firstWord = cmd.split(/\s+/)[0];
	if (!firstWord) return null;

	// Strip path (e.g., /usr/bin/git -> git)
	const basename = firstWord.split("/").pop() ?? firstWord;

	return basename;
}
