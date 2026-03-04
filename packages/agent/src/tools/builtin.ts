/**
 * Register all built-in tools with the registry.
 */

import { astGrepDefinition, astGrepHandler, astPatchDefinition, astPatchHandler } from "./ast-patch.js";
import { bashDefinition, bashHandler } from "./bash.js";
import { composeDefinition, createComposeHandler } from "./compose.js";
import { diffReviewDefinition, diffReviewHandler } from "./diff-review.js";
import { editDefinition, editHandler } from "./edit.js";
import { globDefinition, globHandler } from "./glob.js";
import { grepDefinition, grepHandler } from "./grep.js";
import { readDefinition, readHandler } from "./read.js";
import type { ToolRegistry } from "./registry.js";
import {
	worktreeCreateDefinition,
	worktreeCreateHandler,
	worktreeDestroyDefinition,
	worktreeDestroyHandler,
	worktreeExecDefinition,
	worktreeExecHandler,
	worktreeMergeDefinition,
	worktreeMergeHandler,
} from "./worktree.js";
import { writeDefinition, writeHandler } from "./write.js";

export function registerBuiltinTools(registry: ToolRegistry): void {
	registry.register(readDefinition, readHandler);
	registry.register(writeDefinition, writeHandler);
	registry.register(editDefinition, editHandler);
	registry.register(bashDefinition, bashHandler);
	registry.register(globDefinition, globHandler);
	registry.register(grepDefinition, grepHandler);

	// Phase 27 — Speculative worktrees
	registry.register(worktreeCreateDefinition, worktreeCreateHandler);
	registry.register(worktreeExecDefinition, worktreeExecHandler);
	registry.register(worktreeMergeDefinition, worktreeMergeHandler);
	registry.register(worktreeDestroyDefinition, worktreeDestroyHandler);

	// Phase 28 — AST-aware patching
	registry.register(astGrepDefinition, astGrepHandler);
	registry.register(astPatchDefinition, astPatchHandler);

	// Phase 31 — Tool compose pipelines
	registry.register(composeDefinition, createComposeHandler(registry));

	// Phase 32 — Semantic diff review (callable as tool)
	registry.register(diffReviewDefinition, diffReviewHandler);
}
