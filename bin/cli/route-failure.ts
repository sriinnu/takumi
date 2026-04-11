/**
 * I format fail-closed startup guidance for operator-facing CLI surfaces.
 *
 * Chitragupta route authority is allowed to fail Takumi closed when the assigned
 * provider/model cannot be executed locally. This helper keeps that message
 * explicit and consistent across interactive and headless entrypoints.
 */
export function formatStartupAccessFailureMessage(error: Error): string {
	return [
		"Error: Takumi could not establish an executable startup route.",
		"",
		"Takumi now boots Chitragupta before provider selection and does not prompt for API keys at startup.",
		"Current builds still need one executable access path after routing resolves:",
		"  • a Darpana proxy URL",
		"  • a local provider endpoint",
		"  • or a locally discoverable credential source",
		"",
		"Next steps:",
		"  • run `takumi doctor` to see which provider/auth paths are actually visible",
		"  • use `takumi config open` if you want to pin a provider, model, endpoint, or proxy",
		"  • start a local runtime like Ollama, or export/login a provider credential source",
		"",
		`Details: ${error.message}`,
	].join("\n");
}

export function formatRouteIncompatibleFailureMessage(error: Error): string {
	return [
		"Route incompatibility: Takumi received an authoritative Chitragupta route that this runtime cannot execute.",
		"",
		"Takumi failed closed instead of silently rerouting to a different provider/model.",
		"Fix the assigned provider path or adjust the upstream route authority, then retry.",
		"",
		`Details: ${error.message}`,
	].join("\n");
}