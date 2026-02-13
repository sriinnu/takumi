export { McpClient } from "./mcp-client.js";
export type { McpClientOptions } from "./mcp-client.js";

export { ChitraguptaBridge } from "./chitragupta.js";
export type {
	ChitraguptaBridgeOptions,
	MemoryResult,
	ChitraguptaSessionInfo,
	SessionDetail,
	HandoverSummary,
	AkashaTrace,
} from "./chitragupta.js";

export { DarpanaClient } from "./darpana.js";
export type { DarpanaConfig } from "./darpana.js";

export {
	isGitRepo,
	gitBranch,
	gitMainBranch,
	gitStatus,
	gitDiff,
	gitDiffRef,
	gitLog,
	gitRoot,
} from "./git.js";
export type { GitStatus, GitLogEntry } from "./git.js";
