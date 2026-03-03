import type { TakumiConfig } from "@takumi/core";

export interface CliArgs {
	help: boolean;
	version: boolean;
	model?: string;
	thinking: boolean;
	thinkingBudget?: number;
	proxy?: string;
	provider?: string;
	fallback?: string;
	apiKey?: string;
	endpoint?: string;
	theme?: string;
	logLevel?: string;
	workingDirectory?: string;
	prompt: string[];
	print: boolean;
	resume?: string;
	subcommand?: string;
	subcommandArg?: string;
	pr: boolean;
	ship: boolean;
	detach: boolean;
	issue?: string;
	yes: boolean;
	stream?: "text" | "ndjson";
}

export interface DetachedJobRecord {
	id: string;
	pid: number;
	logFile: string;
	cwd: string;
	startedAt: number;
	status?: "running" | "stopped" | "exited";
	stoppedAt?: number;
	command?: string;
	args?: string[];
}

export type TakumiConfigLike = TakumiConfig;
