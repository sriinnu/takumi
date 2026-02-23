/**
 * Register all built-in tools with the registry.
 */

import { bashDefinition, bashHandler } from "./bash.js";
import { editDefinition, editHandler } from "./edit.js";
import { globDefinition, globHandler } from "./glob.js";
import { grepDefinition, grepHandler } from "./grep.js";
import { readDefinition, readHandler } from "./read.js";
import type { ToolRegistry } from "./registry.js";
import { writeDefinition, writeHandler } from "./write.js";

export function registerBuiltinTools(registry: ToolRegistry): void {
	registry.register(readDefinition, readHandler);
	registry.register(writeDefinition, writeHandler);
	registry.register(editDefinition, editHandler);
	registry.register(bashDefinition, bashHandler);
	registry.register(globDefinition, globHandler);
	registry.register(grepDefinition, grepHandler);
}
