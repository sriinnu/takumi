import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** npm dependency name -> framework name. */
const FRAMEWORK_MAP: Record<string, string> = {
	next: "Next.js",
	nuxt: "Nuxt",
	"@angular/core": "Angular",
	vue: "Vue",
	svelte: "Svelte",
	"@sveltejs/kit": "SvelteKit",
	react: "React",
	"react-native": "React Native",
	express: "Express",
	fastify: "Fastify",
	koa: "Koa",
	hono: "Hono",
	nestjs: "NestJS",
	"@nestjs/core": "NestJS",
	gatsby: "Gatsby",
	remix: "Remix",
	"@remix-run/node": "Remix",
	astro: "Astro",
	electron: "Electron",
	tauri: "Tauri",
	vite: "Vite",
};

/** Python dependency name -> framework name. */
const PYTHON_FRAMEWORK_MAP: Record<string, string> = {
	fastapi: "FastAPI",
	django: "Django",
	flask: "Flask",
	starlette: "Starlette",
	tornado: "Tornado",
	pyramid: "Pyramid",
	sanic: "Sanic",
	aiohttp: "aiohttp",
};

/** Detect the framework from project dependency files. */
export function detectFramework(root: string, language: string | null): string | null {
	if (existsSync(join(root, "package.json"))) {
		try {
			const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
			const deps = { ...pkg.dependencies, ...pkg.devDependencies };

			const priorityOrder = [
				"next",
				"@remix-run/node",
				"remix",
				"nuxt",
				"@sveltejs/kit",
				"astro",
				"gatsby",
				"@nestjs/core",
				"nestjs",
				"express",
				"fastify",
				"koa",
				"hono",
				"react-native",
				"electron",
				"tauri",
				"@angular/core",
				"vue",
				"svelte",
				"react",
			];

			for (const dep of priorityOrder) {
				if (dep in deps && dep in FRAMEWORK_MAP) {
					return FRAMEWORK_MAP[dep];
				}
			}
		} catch {
			/* ignore parse errors */
		}
	}

	if (language === "Python") {
		return detectPythonFramework(root);
	}

	return null;
}

/** Detect Python framework from pyproject.toml or requirements.txt. */
function detectPythonFramework(root: string): string | null {
	const pyprojectPath = join(root, "pyproject.toml");
	if (existsSync(pyprojectPath)) {
		try {
			const content = readFileSync(pyprojectPath, "utf-8");
			for (const [dep, framework] of Object.entries(PYTHON_FRAMEWORK_MAP)) {
				if (content.includes(dep)) return framework;
			}
		} catch {
			/* ignore */
		}
	}

	const reqPath = join(root, "requirements.txt");
	if (existsSync(reqPath)) {
		try {
			const content = readFileSync(reqPath, "utf-8").toLowerCase();
			for (const [dep, framework] of Object.entries(PYTHON_FRAMEWORK_MAP)) {
				if (content.includes(dep)) return framework;
			}
		} catch {
			/* ignore */
		}
	}

	return null;
}
