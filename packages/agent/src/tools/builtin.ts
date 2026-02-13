/**
 * Register all built-in tools with the registry.
 */

import type { ToolRegistry } from "./registry.js";
import { readDefinition, readHandler } from "./read.js";
import { writeDefinition, writeHandler } from "./write.js";
import { editDefinition, editHandler } from "./edit.js";
import { bashDefinition, bashHandler } from "./bash.js";
import { globDefinition, globHandler } from "./glob.js";
import { grepDefinition, grepHandler } from "./grep.js";

export function registerBuiltinTools(registry: ToolRegistry): void {
	registry.register(readDefinition, readHandler);
	registry.register(writeDefinition, writeHandler);
	registry.register(editDefinition, editHandler);
	registry.register(bashDefinition, bashHandler);
	registry.register(globDefinition, globHandler);
	registry.register(grepDefinition, grepHandler);
}
