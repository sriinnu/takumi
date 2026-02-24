/**
 * Aggregates syntax-rule maps from smaller modules.
 */

import type { LanguageRules } from "./syntax.js";
import { DOMAIN_LANGUAGE_MAP, MARKDOWN_RULES } from "./syntax-rules-domain.js";
import { SYSTEM_LANGUAGE_MAP } from "./syntax-rules-systems.js";
import { WEB_LANGUAGE_MAP } from "./syntax-rules-web.js";

export { MARKDOWN_RULES };

export const LANGUAGE_MAP: Record<string, LanguageRules> = {
	...WEB_LANGUAGE_MAP,
	...SYSTEM_LANGUAGE_MAP,
	...DOMAIN_LANGUAGE_MAP,
};
