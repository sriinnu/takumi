import { describe, expect, it } from "vitest";
import { parseArgs } from "../cli/args.js";

describe("parseArgs", () => {
	it("parses daemon as a subcommand", () => {
		const args = parseArgs(["node", "takumi", "daemon", "status"]);
		expect(args.subcommand).toBe("daemon");
		expect(args.subcommandArg).toBe("status");
	});

	it("parses exec as a prompt-preserving subcommand", () => {
		const args = parseArgs(["node", "takumi", "exec", "fix", "login", "bug"]);
		expect(args.subcommand).toBe("exec");
		expect(args.subcommandArg).toBeUndefined();
		expect(args.prompt).toEqual(["fix", "login", "bug"]);
	});

	it("parses headless ndjson flags for spawn mode", () => {
		const args = parseArgs(["node", "takumi", "exec", "--headless", "--stream=ndjson", "fix bug"]);
		expect(args.subcommand).toBe("exec");
		expect(args.headless).toBe(true);
		expect(args.stream).toBe("ndjson");
		expect(args.prompt).toEqual(["fix bug"]);
	});

	it("records invalid stream formats for later usage validation", () => {
		const args = parseArgs(["node", "takumi", "exec", "--stream=xml", "fix bug"]);
		expect(args.stream).toBeUndefined();
		expect(args.invalidStream).toBe("xml");
	});

	it("parses doctor as a subcommand and supports --json", () => {
		const args = parseArgs(["node", "takumi", "doctor", "--json"]);
		expect(args.subcommand).toBe("doctor");
		expect(args.json).toBe(true);
	});

	it("parses --startup-trace for opt-in CLI profiling", () => {
		const args = parseArgs(["node", "takumi", "--startup-trace", "exec", "--headless", "fix bug"]);
		expect(args.startupTrace).toBe(true);
		expect(args.subcommand).toBe("exec");
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

	it("parses side-agents repair as an operational subcommand", () => {
		const args = parseArgs(["node", "takumi", "side-agents", "repair", "--json"]);
		expect(args.subcommand).toBe("side-agents");
		expect(args.subcommandArg).toBe("repair");
		expect(args.json).toBe(true);
	});
});
