import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { KeyEvent } from "@takumi/core";
import { KEY_CODES } from "@takumi/core";
import { Screen } from "@takumi/render";
import { AppState } from "../src/state.js";
import {
	scanDirectory,
	loadGitignore,
	flattenTree,
	parseGitignore,
	matchesGitignore,
	applyGitStatus,
	FileTreePanel,
} from "../src/panels/file-tree.js";
import type { FileNode, FlatRow } from "../src/panels/file-tree.js";

// ── Mock fs ──────────────────────────────────────────────────────────────────

vi.mock("node:fs/promises", () => {
	const mockFS: Record<string, string> = {
		"/project/.gitignore": "*.log\n# comment\ntmp/\n.env\n",
	};

	interface MockDirent {
		name: string;
		isDirectory(): boolean;
		isFile(): boolean;
	}

	// Simulated directory structure
	const dirStructure: Record<string, MockDirent[]> = {
		"/project": [
			{ name: "src", isDirectory: () => true, isFile: () => false },
			{ name: "test", isDirectory: () => true, isFile: () => false },
			{ name: "node_modules", isDirectory: () => true, isFile: () => false },
			{ name: ".git", isDirectory: () => true, isFile: () => false },
			{ name: "package.json", isDirectory: () => false, isFile: () => true },
			{ name: "tsconfig.json", isDirectory: () => false, isFile: () => true },
			{ name: "app.log", isDirectory: () => false, isFile: () => true },
			{ name: ".env", isDirectory: () => false, isFile: () => true },
			{ name: ".gitignore", isDirectory: () => false, isFile: () => true },
		],
		"/project/src": [
			{ name: "panels", isDirectory: () => true, isFile: () => false },
			{ name: "views", isDirectory: () => true, isFile: () => false },
			{ name: "app.ts", isDirectory: () => false, isFile: () => true },
			{ name: "state.ts", isDirectory: () => false, isFile: () => true },
		],
		"/project/src/panels": [
			{ name: "message-list.ts", isDirectory: () => false, isFile: () => true },
			{ name: "editor.ts", isDirectory: () => false, isFile: () => true },
			{ name: "file-tree.ts", isDirectory: () => false, isFile: () => true },
		],
		"/project/src/views": [
			{ name: "chat.ts", isDirectory: () => false, isFile: () => true },
		],
		"/project/test": [
			{ name: "file-tree.test.ts", isDirectory: () => false, isFile: () => true },
		],
		"/empty": [],
		"/deep/l1": [
			{ name: "l2", isDirectory: () => true, isFile: () => false },
		],
		"/deep/l1/l2": [
			{ name: "l3", isDirectory: () => true, isFile: () => false },
		],
		"/deep/l1/l2/l3": [
			{ name: "l4", isDirectory: () => true, isFile: () => false },
		],
		"/deep/l1/l2/l3/l4": [
			{ name: "l5", isDirectory: () => true, isFile: () => false },
		],
		"/deep/l1/l2/l3/l4/l5": [
			{ name: "l6", isDirectory: () => true, isFile: () => false },
		],
		"/deep/l1/l2/l3/l4/l5/l6": [
			{ name: "deep-file.ts", isDirectory: () => false, isFile: () => true },
		],
		"/hidden": [
			{ name: ".hidden-file", isDirectory: () => false, isFile: () => true },
			{ name: ".hidden-dir", isDirectory: () => true, isFile: () => false },
			{ name: "visible.ts", isDirectory: () => false, isFile: () => true },
		],
		"/hidden/.hidden-dir": [
			{ name: "inside.ts", isDirectory: () => false, isFile: () => true },
		],
	};

	return {
		readdir: vi.fn(async (path: string, _opts?: unknown) => {
			const normalized = path.replace(/\\/g, "/");
			const entries = dirStructure[normalized];
			if (!entries) throw new Error(`ENOENT: no such directory '${normalized}'`);
			return entries;
		}),
		readFile: vi.fn(async (path: string, _encoding?: string) => {
			const normalized = path.replace(/\\/g, "/");
			const content = mockFS[normalized];
			if (content === undefined) throw new Error(`ENOENT: no such file '${normalized}'`);
			return content;
		}),
		stat: vi.fn(async (_path: string) => ({ isDirectory: () => false, isFile: () => true })),
	};
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeKey(raw: string, overrides: Partial<KeyEvent> = {}): KeyEvent {
	return {
		key: raw,
		ctrl: false,
		alt: false,
		shift: false,
		meta: false,
		raw,
		...overrides,
	};
}

function createState(): AppState {
	return new AppState();
}

function createPanel(overrides: Partial<Parameters<typeof FileTreePanel.prototype.constructor>[0]> = {}): FileTreePanel {
	const state = createState();
	state.sidebarVisible.value = true;
	return new FileTreePanel({
		state,
		rootPath: "/project",
		...overrides,
	} as any);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("parseGitignore", () => {
	it("parses patterns from .gitignore content", () => {
		const patterns = parseGitignore("*.log\n# comment\ntmp/\n.env\n");
		expect(patterns).toEqual(["*.log", "tmp/", ".env"]);
	});

	it("skips empty lines", () => {
		const patterns = parseGitignore("foo\n\nbar\n\n");
		expect(patterns).toEqual(["foo", "bar"]);
	});

	it("skips comment lines", () => {
		const patterns = parseGitignore("# this is a comment\nfoo\n# another");
		expect(patterns).toEqual(["foo"]);
	});

	it("returns empty array for empty content", () => {
		expect(parseGitignore("")).toEqual([]);
	});

	it("handles whitespace-only lines", () => {
		const patterns = parseGitignore("  \nfoo\n  \n");
		expect(patterns).toEqual(["foo"]);
	});
});

describe("matchesGitignore", () => {
	it("matches exact file name", () => {
		expect(matchesGitignore(".env", false, [".env"])).toBe(true);
	});

	it("matches glob *.ext pattern", () => {
		expect(matchesGitignore("app.log", false, ["*.log"])).toBe(true);
	});

	it("does not match different extension", () => {
		expect(matchesGitignore("app.ts", false, ["*.log"])).toBe(false);
	});

	it("matches directory pattern with trailing slash", () => {
		expect(matchesGitignore("tmp", true, ["tmp/"])).toBe(true);
	});

	it("does not match file against dir-only pattern", () => {
		expect(matchesGitignore("tmp", false, ["tmp/"])).toBe(false);
	});

	it("matches pattern with leading slash", () => {
		expect(matchesGitignore("build", true, ["/build"])).toBe(true);
	});

	it("skips negation patterns", () => {
		expect(matchesGitignore("important.log", false, ["*.log", "!important.log"])).toBe(true);
	});

	it("matches prefix glob", () => {
		expect(matchesGitignore("test_output", false, ["test_*"])).toBe(true);
	});

	it("returns false for no matching patterns", () => {
		expect(matchesGitignore("main.ts", false, ["*.log", "tmp/"])).toBe(false);
	});

	it("returns false for empty patterns", () => {
		expect(matchesGitignore("anything.ts", false, [])).toBe(false);
	});
});

describe("scanDirectory", () => {
	it("returns a tree structure", async () => {
		const tree = await scanDirectory("/project", 5, []);
		expect(tree.length).toBeGreaterThan(0);
	});

	it("sorts directories before files", async () => {
		const tree = await scanDirectory("/project", 5, []);
		const firstDir = tree.findIndex((n) => n.isDirectory);
		const firstFile = tree.findIndex((n) => !n.isDirectory);
		// If there are dirs and files, dirs should come first
		if (firstDir !== -1 && firstFile !== -1) {
			expect(firstDir).toBeLessThan(firstFile);
		}
	});

	it("always skips node_modules", async () => {
		const tree = await scanDirectory("/project", 5, []);
		const nm = tree.find((n) => n.name === "node_modules");
		expect(nm).toBeUndefined();
	});

	it("always skips .git", async () => {
		const tree = await scanDirectory("/project", 5, []);
		const git = tree.find((n) => n.name === ".git");
		expect(git).toBeUndefined();
	});

	it("respects .gitignore patterns", async () => {
		const tree = await scanDirectory("/project", 5, ["*.log", ".env"]);
		const logFile = tree.find((n) => n.name === "app.log");
		expect(logFile).toBeUndefined();
		const envFile = tree.find((n) => n.name === ".env");
		expect(envFile).toBeUndefined();
	});

	it("includes non-ignored files", async () => {
		const tree = await scanDirectory("/project", 5, ["*.log", ".env"]);
		const pkg = tree.find((n) => n.name === "package.json");
		expect(pkg).toBeDefined();
	});

	it("sets correct depth on children", async () => {
		const tree = await scanDirectory("/project", 5, []);
		const src = tree.find((n) => n.name === "src");
		expect(src).toBeDefined();
		expect(src!.depth).toBe(0);
		expect(src!.children).toBeDefined();
		if (src!.children && src!.children.length > 0) {
			expect(src!.children[0].depth).toBe(1);
		}
	});

	it("populates children for directories", async () => {
		const tree = await scanDirectory("/project", 5, []);
		const src = tree.find((n) => n.name === "src");
		expect(src?.children).toBeDefined();
		expect(src!.children!.length).toBeGreaterThan(0);
	});

	it("honors max depth", async () => {
		const tree = await scanDirectory("/deep", 2, [], 0, "l1");
		// Should go l2 (depth 1) -> l3 (depth 2) and stop
		const l2 = tree.find((n) => n.name === "l2");
		expect(l2).toBeDefined();
		if (l2?.children) {
			const l3 = l2.children.find((n) => n.name === "l3");
			// Max depth is 2, currentDepth starts at 0 for "l1"
			// l2 at depth 1, l3 at depth 2, l4 at depth 3 > maxDepth -> children empty
			if (l3?.children) {
				const l4 = l3.children.find((n) => n.name === "l4");
				if (l4?.children) {
					// depth 3 > maxDepth 2, so l4's children should be scanned at depth 3
					// Actually scanDirectory checks currentDepth > maxDepth at the start
					// So at depth 3 (l4), it returns []. l5/l6 won't exist.
					expect(l4.children.length).toBe(0);
				}
			}
		}
	});

	it("handles empty directory", async () => {
		const tree = await scanDirectory("/empty", 5, []);
		expect(tree).toEqual([]);
	});

	it("handles nonexistent directory gracefully", async () => {
		const tree = await scanDirectory("/nonexistent", 5, []);
		expect(tree).toEqual([]);
	});

	it("handles hidden files", async () => {
		const tree = await scanDirectory("/hidden", 5, []);
		const hidden = tree.find((n) => n.name === ".hidden-file");
		expect(hidden).toBeDefined();
		expect(hidden!.isDirectory).toBe(false);
	});

	it("handles hidden directories", async () => {
		const tree = await scanDirectory("/hidden", 5, []);
		const hiddenDir = tree.find((n) => n.name === ".hidden-dir");
		expect(hiddenDir).toBeDefined();
		expect(hiddenDir!.isDirectory).toBe(true);
	});

	it("sets correct FileNode structure", async () => {
		const tree = await scanDirectory("/project", 5, []);
		const pkg = tree.find((n) => n.name === "package.json");
		expect(pkg).toMatchObject({
			name: "package.json",
			path: "package.json",
			isDirectory: false,
			depth: 0,
		});
	});

	it("sorts alphabetically within same type", async () => {
		const tree = await scanDirectory("/project", 5, []);
		const files = tree.filter((n) => !n.isDirectory);
		const names = files.map((n) => n.name);
		const sorted = [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
		expect(names).toEqual(sorted);
	});
});

describe("loadGitignore", () => {
	it("loads patterns from .gitignore file", async () => {
		const patterns = await loadGitignore("/project");
		expect(patterns).toContain("*.log");
		expect(patterns).toContain("tmp/");
		expect(patterns).toContain(".env");
	});

	it("returns empty array if .gitignore does not exist", async () => {
		const patterns = await loadGitignore("/empty");
		expect(patterns).toEqual([]);
	});
});

describe("flattenTree", () => {
	const tree: FileNode[] = [
		{
			name: "src",
			path: "src",
			isDirectory: true,
			depth: 0,
			children: [
				{ name: "app.ts", path: "src/app.ts", isDirectory: false, depth: 1 },
				{ name: "state.ts", path: "src/state.ts", isDirectory: false, depth: 1 },
			],
		},
		{
			name: "test",
			path: "test",
			isDirectory: true,
			depth: 0,
			children: [
				{ name: "app.test.ts", path: "test/app.test.ts", isDirectory: false, depth: 1 },
			],
		},
		{ name: "package.json", path: "package.json", isDirectory: false, depth: 0 },
	];

	it("flattens collapsed tree to top-level only", () => {
		const rows = flattenTree(tree, new Set());
		expect(rows.length).toBe(3);
	});

	it("flattens expanded directory to include children", () => {
		const rows = flattenTree(tree, new Set(["src"]));
		expect(rows.length).toBe(5); // src + 2 children + test + package.json
	});

	it("flattens multiple expanded directories", () => {
		const rows = flattenTree(tree, new Set(["src", "test"]));
		expect(rows.length).toBe(6); // src + 2 + test + 1 + package.json
	});

	it("marks directories as expanded", () => {
		const rows = flattenTree(tree, new Set(["src"]));
		const srcRow = rows.find((r) => r.node.name === "src");
		expect(srcRow?.isExpanded).toBe(true);
	});

	it("marks collapsed directories as not expanded", () => {
		const rows = flattenTree(tree, new Set());
		const srcRow = rows.find((r) => r.node.name === "src");
		expect(srcRow?.isExpanded).toBe(false);
	});

	it("sets isExpanded to undefined for files", () => {
		const rows = flattenTree(tree, new Set(["src"]));
		const fileRow = rows.find((r) => r.node.name === "app.ts");
		expect(fileRow?.isExpanded).toBeUndefined();
	});

	it("marks last child correctly", () => {
		const rows = flattenTree(tree, new Set());
		const lastRow = rows[rows.length - 1];
		expect(lastRow.isLastChild).toBe(true);
		expect(rows[0].isLastChild).toBe(false);
	});

	it("includes tree parts for indentation", () => {
		const rows = flattenTree(tree, new Set(["src"]));
		const appRow = rows.find((r) => r.node.name === "app.ts");
		expect(appRow?.treeParts.length).toBeGreaterThan(0);
	});

	it("handles empty tree", () => {
		const rows = flattenTree([], new Set());
		expect(rows).toEqual([]);
	});

	it("handles single file", () => {
		const single: FileNode[] = [{ name: "a.ts", path: "a.ts", isDirectory: false, depth: 0 }];
		const rows = flattenTree(single, new Set());
		expect(rows.length).toBe(1);
		expect(rows[0].isLastChild).toBe(true);
	});
});

describe("applyGitStatus", () => {
	it("marks modified files", () => {
		const tree: FileNode[] = [
			{ name: "a.ts", path: "a.ts", isDirectory: false, depth: 0 },
			{ name: "b.ts", path: "b.ts", isDirectory: false, depth: 0 },
		];
		applyGitStatus(tree, ["a.ts"], []);
		expect(tree[0].modified).toBe(true);
		expect(tree[1].modified).toBe(false);
	});

	it("marks staged files", () => {
		const tree: FileNode[] = [
			{ name: "a.ts", path: "a.ts", isDirectory: false, depth: 0 },
		];
		applyGitStatus(tree, [], ["a.ts"]);
		expect(tree[0].staged).toBe(true);
	});

	it("marks both modified and staged", () => {
		const tree: FileNode[] = [
			{ name: "a.ts", path: "a.ts", isDirectory: false, depth: 0 },
		];
		applyGitStatus(tree, ["a.ts"], ["a.ts"]);
		expect(tree[0].modified).toBe(true);
		expect(tree[0].staged).toBe(true);
	});

	it("walks into children", () => {
		const tree: FileNode[] = [
			{
				name: "src",
				path: "src",
				isDirectory: true,
				depth: 0,
				children: [
					{ name: "app.ts", path: "src/app.ts", isDirectory: false, depth: 1 },
				],
			},
		];
		applyGitStatus(tree, ["src/app.ts"], []);
		expect(tree[0].children![0].modified).toBe(true);
	});

	it("does not mark directories", () => {
		const tree: FileNode[] = [
			{
				name: "src",
				path: "src",
				isDirectory: true,
				depth: 0,
				children: [],
			},
		];
		applyGitStatus(tree, ["src"], []);
		expect(tree[0].modified).toBeUndefined();
	});

	it("handles empty tree", () => {
		const tree: FileNode[] = [];
		// Should not throw
		applyGitStatus(tree, ["a.ts"], []);
		expect(tree).toEqual([]);
	});
});

describe("FileTreePanel", () => {
	describe("navigation", () => {
		it("selectNext moves selection down", () => {
			const panel = createPanel();
			// Manually set files
			panel.files.value = [
				{ name: "a.ts", path: "a.ts", isDirectory: false, depth: 0 },
				{ name: "b.ts", path: "b.ts", isDirectory: false, depth: 0 },
			];
			expect(panel.selectedIndex.value).toBe(0);
			panel.selectNext();
			expect(panel.selectedIndex.value).toBe(1);
		});

		it("selectPrev moves selection up", () => {
			const panel = createPanel();
			panel.files.value = [
				{ name: "a.ts", path: "a.ts", isDirectory: false, depth: 0 },
				{ name: "b.ts", path: "b.ts", isDirectory: false, depth: 0 },
			];
			panel.selectNext();
			panel.selectPrev();
			expect(panel.selectedIndex.value).toBe(0);
		});

		it("selectPrev at top does not go below 0", () => {
			const panel = createPanel();
			panel.files.value = [
				{ name: "a.ts", path: "a.ts", isDirectory: false, depth: 0 },
			];
			panel.selectPrev();
			expect(panel.selectedIndex.value).toBe(0);
		});

		it("selectNext at bottom does not exceed bounds", () => {
			const panel = createPanel();
			panel.files.value = [
				{ name: "a.ts", path: "a.ts", isDirectory: false, depth: 0 },
				{ name: "b.ts", path: "b.ts", isDirectory: false, depth: 0 },
			];
			panel.selectNext();
			panel.selectNext(); // Already at last
			expect(panel.selectedIndex.value).toBe(1);
		});

		it("navigates with arrow keys", () => {
			const panel = createPanel();
			panel.files.value = [
				{ name: "a.ts", path: "a.ts", isDirectory: false, depth: 0 },
				{ name: "b.ts", path: "b.ts", isDirectory: false, depth: 0 },
			];

			const consumed = panel.handleKey(makeKey(KEY_CODES.DOWN));
			expect(consumed).toBe(true);
			expect(panel.selectedIndex.value).toBe(1);

			panel.handleKey(makeKey(KEY_CODES.UP));
			expect(panel.selectedIndex.value).toBe(0);
		});

		it("returns false for unhandled keys", () => {
			const panel = createPanel();
			panel.files.value = [
				{ name: "a.ts", path: "a.ts", isDirectory: false, depth: 0 },
			];
			const consumed = panel.handleKey(makeKey("x"));
			expect(consumed).toBe(false);
		});
	});

	describe("expand/collapse", () => {
		it("toggleExpand expands a collapsed directory", () => {
			const panel = createPanel();
			panel.files.value = [
				{
					name: "src",
					path: "src",
					isDirectory: true,
					depth: 0,
					children: [{ name: "a.ts", path: "src/a.ts", isDirectory: false, depth: 1 }],
				},
			];

			expect(panel.expandedDirs.value.has("src")).toBe(false);
			panel.toggleExpand();
			expect(panel.expandedDirs.value.has("src")).toBe(true);
		});

		it("toggleExpand collapses an expanded directory", () => {
			const panel = createPanel();
			panel.files.value = [
				{
					name: "src",
					path: "src",
					isDirectory: true,
					depth: 0,
					children: [{ name: "a.ts", path: "src/a.ts", isDirectory: false, depth: 1 }],
				},
			];

			panel.toggleExpand(); // expand
			panel.toggleExpand(); // collapse
			expect(panel.expandedDirs.value.has("src")).toBe(false);
		});

		it("space key toggles expand/collapse", () => {
			const panel = createPanel();
			panel.files.value = [
				{
					name: "src",
					path: "src",
					isDirectory: true,
					depth: 0,
					children: [{ name: "a.ts", path: "src/a.ts", isDirectory: false, depth: 1 }],
				},
			];

			panel.handleKey(makeKey(" "));
			expect(panel.expandedDirs.value.has("src")).toBe(true);
		});

		it("enter on directory toggles it", () => {
			const panel = createPanel();
			panel.files.value = [
				{
					name: "src",
					path: "src",
					isDirectory: true,
					depth: 0,
					children: [],
				},
			];

			const result = panel.confirmSelection();
			expect(result).toBeNull(); // dir returns null
			expect(panel.expandedDirs.value.has("src")).toBe(true);
		});

		it("does nothing when toggling a file", () => {
			const panel = createPanel();
			panel.files.value = [
				{ name: "a.ts", path: "a.ts", isDirectory: false, depth: 0 },
			];

			panel.toggleExpand();
			expect(panel.expandedDirs.value.size).toBe(0);
		});

		it("expanding a directory increases visible rows", () => {
			const panel = createPanel();
			panel.files.value = [
				{
					name: "src",
					path: "src",
					isDirectory: true,
					depth: 0,
					children: [
						{ name: "a.ts", path: "src/a.ts", isDirectory: false, depth: 1 },
						{ name: "b.ts", path: "src/b.ts", isDirectory: false, depth: 1 },
					],
				},
			];

			expect(panel.visibleRowCount).toBe(1);
			panel.toggleExpand();
			expect(panel.visibleRowCount).toBe(3);
		});
	});

	describe("file selection", () => {
		it("confirmSelection on file returns full path", () => {
			const panel = createPanel();
			panel.files.value = [
				{ name: "a.ts", path: "a.ts", isDirectory: false, depth: 0 },
			];

			const result = panel.confirmSelection();
			expect(result).toBe("/project/a.ts");
		});

		it("confirmSelection calls onFileSelect callback", () => {
			const onSelect = vi.fn();
			const state = createState();
			state.sidebarVisible.value = true;
			const panel = new FileTreePanel({ state, rootPath: "/project", onFileSelect: onSelect });
			panel.files.value = [
				{ name: "a.ts", path: "a.ts", isDirectory: false, depth: 0 },
			];

			panel.confirmSelection();
			expect(onSelect).toHaveBeenCalledWith("/project/a.ts");
		});

		it("enter key on file selects it", () => {
			const onSelect = vi.fn();
			const state = createState();
			state.sidebarVisible.value = true;
			const panel = new FileTreePanel({ state, rootPath: "/project", onFileSelect: onSelect });
			panel.files.value = [
				{ name: "a.ts", path: "a.ts", isDirectory: false, depth: 0 },
			];

			panel.handleKey(makeKey(KEY_CODES.ENTER));
			expect(onSelect).toHaveBeenCalledWith("/project/a.ts");
		});

		it("confirmSelection on empty tree returns null", () => {
			const panel = createPanel();
			const result = panel.confirmSelection();
			expect(result).toBeNull();
		});
	});

	describe("scrolling", () => {
		it("auto-scrolls down when selecting past viewport", () => {
			const panel = createPanel();
			const files: FileNode[] = [];
			for (let i = 0; i < 30; i++) {
				files.push({ name: `file${i}.ts`, path: `file${i}.ts`, isDirectory: false, depth: 0 });
			}
			panel.files.value = files;

			// Move selection past viewport
			for (let i = 0; i < 25; i++) {
				panel.selectNext();
			}
			expect(panel.selectedIndex.value).toBe(25);
			// Scroll offset should have adjusted
			// (exact value depends on viewport height, which defaults to 20)
		});

		it("auto-scrolls up when selecting above viewport", () => {
			const panel = createPanel();
			const files: FileNode[] = [];
			for (let i = 0; i < 30; i++) {
				files.push({ name: `file${i}.ts`, path: `file${i}.ts`, isDirectory: false, depth: 0 });
			}
			panel.files.value = files;

			// Scroll down then back up
			for (let i = 0; i < 25; i++) panel.selectNext();
			for (let i = 0; i < 25; i++) panel.selectPrev();
			expect(panel.selectedIndex.value).toBe(0);
			expect(panel.scrollOffset.value).toBe(0);
		});
	});

	describe("getSelectedRow", () => {
		it("returns the currently selected row", () => {
			const panel = createPanel();
			panel.files.value = [
				{ name: "a.ts", path: "a.ts", isDirectory: false, depth: 0 },
				{ name: "b.ts", path: "b.ts", isDirectory: false, depth: 0 },
			];
			panel.selectNext();
			const row = panel.getSelectedRow();
			expect(row?.node.name).toBe("b.ts");
		});

		it("returns null for empty tree", () => {
			const panel = createPanel();
			expect(panel.getSelectedRow()).toBeNull();
		});
	});

	describe("git status integration", () => {
		it("refreshGitStatus marks modified files", () => {
			const panel = createPanel();
			panel.files.value = [
				{ name: "a.ts", path: "a.ts", isDirectory: false, depth: 0 },
				{ name: "b.ts", path: "b.ts", isDirectory: false, depth: 0 },
			];
			panel.refreshGitStatus(["a.ts"], []);
			const row = panel.getSelectedRow();
			expect(row?.node.modified).toBe(true);
		});

		it("refreshGitStatus marks staged files", () => {
			const panel = createPanel();
			panel.files.value = [
				{ name: "a.ts", path: "a.ts", isDirectory: false, depth: 0 },
			];
			panel.refreshGitStatus([], ["a.ts"]);
			const row = panel.getSelectedRow();
			expect(row?.node.staged).toBe(true);
		});

		it("refreshGitStatus on empty tree does nothing", () => {
			const panel = createPanel();
			// Should not throw
			panel.refreshGitStatus(["a.ts"], ["b.ts"]);
			expect(panel.visibleRowCount).toBe(0);
		});
	});

	describe("rendering", () => {
		it("renders without errors when sidebar is visible", () => {
			const state = createState();
			state.sidebarVisible.value = true;
			const panel = new FileTreePanel({ state, rootPath: "/project" });
			panel.files.value = [
				{ name: "src", path: "src", isDirectory: true, depth: 0, children: [] },
				{ name: "a.ts", path: "a.ts", isDirectory: false, depth: 0 },
			];

			const screen = new Screen(40, 20);
			expect(() => {
				panel.render(screen, { x: 0, y: 0, width: 30, height: 20 });
			}).not.toThrow();
		});

		it("does not render when sidebar is hidden", () => {
			const state = createState();
			state.sidebarVisible.value = false;
			const panel = new FileTreePanel({ state, rootPath: "/project" });
			panel.files.value = [
				{ name: "a.ts", path: "a.ts", isDirectory: false, depth: 0 },
			];

			const screen = new Screen(40, 20);
			panel.render(screen, { x: 0, y: 0, width: 30, height: 20 });
			// Check that nothing was written (border would be at 0,0)
			const cell = screen.get(0, 0);
			expect(cell.char).toBe(" ");
		});

		it("renders empty state message", () => {
			const state = createState();
			state.sidebarVisible.value = true;
			const panel = new FileTreePanel({ state, rootPath: "/project" });

			const screen = new Screen(40, 20);
			panel.render(screen, { x: 0, y: 0, width: 30, height: 20 });
			// Should render "(empty)" inside the border
		});

		it("handles very narrow width without error", () => {
			const state = createState();
			state.sidebarVisible.value = true;
			const panel = new FileTreePanel({ state, rootPath: "/project" });
			panel.files.value = [
				{ name: "a.ts", path: "a.ts", isDirectory: false, depth: 0 },
			];

			const screen = new Screen(10, 10);
			expect(() => {
				panel.render(screen, { x: 0, y: 0, width: 4, height: 10 });
			}).not.toThrow();
		});

		it("handles very short height without error", () => {
			const state = createState();
			state.sidebarVisible.value = true;
			const panel = new FileTreePanel({ state, rootPath: "/project" });

			const screen = new Screen(40, 5);
			expect(() => {
				panel.render(screen, { x: 0, y: 0, width: 30, height: 2 });
			}).not.toThrow();
		});
	});

	describe("scan", () => {
		it("scans project directory", async () => {
			const panel = createPanel();
			await panel.scan();
			expect(panel.files.value.length).toBeGreaterThan(0);
		});

		it("scan respects .gitignore", async () => {
			const panel = createPanel();
			await panel.scan();
			const logFile = panel.files.value.find((n) => n.name === "app.log");
			expect(logFile).toBeUndefined();
		});
	});

	describe("cleanup", () => {
		it("onUnmount disposes effects", () => {
			const panel = createPanel();
			expect(() => panel.onUnmount()).not.toThrow();
		});
	});
});
