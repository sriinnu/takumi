import { describe, expect, it } from "vitest";
import { parseArgs } from "../cli/args.js";

describe("parseArgs", () => {
	it("parses daemon as a subcommand", () => {
		const args = parseArgs(["node", "takumi", "daemon", "status"]);
		expect(args.subcommand).toBe("daemon");
		expect(args.subcommandArg).toBe("status");
	});

	it("parses doctor as a subcommand and supports --json", () => {
		const args = parseArgs(["node", "takumi", "doctor", "--json"]);
		expect(args.subcommand).toBe("doctor");
		expect(args.json).toBe(true);
	});

	it("parses --fix for operational subcommands", () => {
		const args = parseArgs(["node", "takumi", "doctor", "--fix"]);
		expect(args.subcommand).toBe("doctor");
		expect(args.fix).toBe(true);
	});

	it("parses platform as a subcommand", () => {
		const args = parseArgs(["node", "takumi", "platform", "--json"]);
		expect(args.subcommand).toBe("platform");
		expect(args.json).toBe(true);
	});

	it("parses platform watch as a subcommand arg", () => {
		const args = parseArgs(["node", "takumi", "platform", "watch"]);
		expect(args.subcommand).toBe("platform");
		expect(args.subcommandArg).toBe("watch");
	});

	it("parses package as a subcommand", () => {
		const args = parseArgs(["node", "takumi", "package", "list", "--json"]);
		expect(args.subcommand).toBe("package");
		expect(args.subcommandArg).toBe("list");
		expect(args.json).toBe(true);
	});

	it("parses package inspect target as prompt args", () => {
		const args = parseArgs(["node", "takumi", "package", "inspect", "review-kit"]);
		expect(args.subcommand).toBe("package");
		expect(args.subcommandArg).toBe("inspect");
		expect(args.prompt).toEqual(["review-kit"]);
	});
});