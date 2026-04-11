import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	build: {
		sourcemap: false,
	},
	server: {
		port: 5173,
		strictPort: true,
		open: true,
		proxy: {
			"/ws": {
				target: "ws://localhost:3100",
				ws: true,
			},
		},
	},
});
