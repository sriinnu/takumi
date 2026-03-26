import type { CliArgs } from "./types.js";

const SUBCOMMANDS = ["exec", "list", "status", "logs", "export", "delete", "jobs", "watch", "attach", "stop", "daemon", "doctor", "platform", "package", "side-agents"];

function parseStreamFormat(value: string | undefined): CliArgs["stream"] {
	if (value === "ndjson" || value === "text") {
		return value;
	}
	return undefined;
}

function assignStreamFormat(args: CliArgs, value: string | undefined): void {
	const parsed = parseStreamFormat(value);
	if (parsed) {
		args.stream = parsed;
		args.invalidStream = undefined;
		return;
	}
	args.invalidStream = value;
}

export function parseArgs(argv: string[]): CliArgs {
	const args: CliArgs = {
		help: false,
		version: false,
		thinking: false,
		prompt: [],
		print: false,
		pr: false,
		ship: false,
		detach: false,
		yes: false,
		json: false,
		fix: false,
	};

	let i = 2;
	while (i < argv.length) {
		const arg = argv[i];

		if (arg.startsWith("--stream=")) {
			assignStreamFormat(args, arg.slice("--stream=".length));
			i++;
			continue;
		}

		switch (arg) {
			case "--help":
			case "-h":
				args.help = true;
				break;
			case "--yes":
			case "-y":
				args.yes = true;
				break;
			case "--version":
			case "-v":
				args.version = true;
				break;
			case "--model":
			case "-m":
				args.model = argv[++i];
				break;
			case "--thinking":
			case "-t":
				args.thinking = true;
				break;
			case "--thinking-budget":
				args.thinkingBudget = Number.parseInt(argv[++i], 10);
				break;
			case "--proxy":
			case "-p":
				args.proxy = argv[++i];
				break;
			case "--provider":
			case "-P":
				args.provider = argv[++i];
				break;
			case "--api-key":
				args.apiKey = argv[++i];
				break;
			case "--endpoint":
				args.endpoint = argv[++i];
				break;
			case "--json":
				args.json = true;
				break;
			case "--fix":
				args.fix = true;
				break;
			case "--theme":
				args.theme = argv[++i];
				break;
			case "--log-level":
				args.logLevel = argv[++i];
				break;
			case "--cwd":
			case "-C":
				args.workingDirectory = argv[++i];
				break;
			case "--print":
				args.print = true;
				break;
			case "--headless":
				args.headless = true;
				break;
			case "--resume":
			case "-r":
				args.resume = argv[++i];
				break;
			case "--fallback":
				args.fallback = argv[++i];
				break;
			case "--pr":
				args.pr = true;
				break;
			case "--ship":
				args.ship = true;
				args.pr = true;
				break;
			case "-d":
			case "--detach":
				args.detach = true;
				break;
			case "--stream":
				assignStreamFormat(args, argv[++i]);
				break;
			case "--issue":
			case "-i":
				args.issue = argv[++i];
				break;
			default:
				if (arg.startsWith("-")) {
					console.error(`Unknown option: ${arg}`);
					process.exit(1);
				}
				args.prompt.push(arg);
		}
		i++;
	}

	if (args.prompt.length > 0 && SUBCOMMANDS.includes(args.prompt[0])) {
		args.subcommand = args.prompt.shift();
		if (args.subcommand !== "exec") {
			args.subcommandArg = args.prompt.shift();
		}
	}

	return args;
}
