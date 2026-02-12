import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		include: ["packages/*/test/**/*.test.ts"],
		alias: {
			"@takumi/core": resolve(__dirname, "packages/core/src/index.ts"),
			"@takumi/render": resolve(__dirname, "packages/render/src/index.ts"),
			"@takumi/agent": resolve(__dirname, "packages/agent/src/index.ts"),
			"@takumi/tui": resolve(__dirname, "packages/tui/src/index.ts"),
			"@takumi/bridge": resolve(__dirname, "packages/bridge/src/index.ts"),
		},
		coverage: {
			provider: "v8",
			include: ["packages/*/src/**/*.ts"],
			exclude: ["packages/*/src/index.ts", "packages/*/src/types.ts"],
		},
		testTimeout: 10000,
		hookTimeout: 10000,
	},
});
