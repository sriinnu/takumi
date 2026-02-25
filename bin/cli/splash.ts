/**
 * splash.ts — TAKUMI startup banner.
 * Full RGB rainbow gradient — one colour per banner row, character-level
 * shimmer on the kanji accent, and a version/tagline footer.
 */

const R = "\x1b[0m";   // reset
const B = "\x1b[1m";   // bold
const D = "\x1b[2m";   // dim

/** Truecolor foreground: \x1b[38;2;<r>;<g>;<b>m */
function rgb(r: number, g: number, b: number): string {
	return `\x1b[38;2;${r};${g};${b}m`;
}

// ── Rainbow gradient rows (top → bottom) ─────────────────────────────────────
//   Electric cyan → sky blue → blue violet → vivid purple → neon pink → coral
const ROW_COLOURS = [
	rgb(0,   229, 255),   // 0  electric cyan
	rgb(72,  202, 228),   // 1  sky blue
	rgb(100, 100, 255),   // 2  electric indigo
	rgb(199, 125, 255),   // 3  lavender
	rgb(224,  64, 251),   // 4  neon pink-purple
	rgb(255, 100, 150),   // 5  coral pink
];

// ── TAKUMI in block characters (6 rows × ~50 cols) ───────────────────────────
const LOGO = [
	"████████╗ █████╗ ██╗  ██╗██╗   ██╗███╗   ███╗██╗",
	"╚══██╔══╝██╔══██╗██║ ██╔╝██║   ██║████╗ ████║██║",
	"   ██║   ███████║█████╔╝ ██║   ██║██╔████╔██║██║",
	"   ██║   ██╔══██║██╔═██╗ ██║   ██║██║╚██╔╝██║██║",
	"   ██║   ██║  ██║██║  ██╗╚██████╔╝██║ ╚═╝ ██║██║",
	"   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝",
];

/** Render one kanji character with a cycling hue across the whole palette. */
function rainbowKanji(char: string, idx: number): string {
	const c = ROW_COLOURS[idx % ROW_COLOURS.length];
	return `${B}${c}${char}${R}`;
}

export function printSplash(version = "0.1.0"): void {
	const PAD = "  ";
	const lines: string[] = [""];

	// Coloured logo rows
	for (let i = 0; i < LOGO.length; i++) {
		lines.push(`${B}${ROW_COLOURS[i]}${PAD}${LOGO[i]}${R}`);
	}

	// Kanji 匠 — each stroke segment in a different hue
	const kanji = "匠";
	const kanjiLabel = kanji
		.split("")
		.map((ch, i) => rainbowKanji(ch, i + 2))
		.join("");
	const kanjiPad = " ".repeat(PAD.length + Math.floor((LOGO[0].length - 1) / 2));
	lines.push(`${kanjiPad}${kanjiLabel}`);
	lines.push("");

	// Tagline
	const tagline = `the master craftsman's coding agent  ·  v${version}`;
	const tagPad  = " ".repeat(PAD.length + Math.floor((LOGO[0].length - tagline.length) / 2));
	lines.push(`${D}${rgb(160, 160, 200)}${tagPad}${tagline}${R}`);
	lines.push("");

	// Colour legend strip — decorative rainbow bar
	const barChars = ROW_COLOURS.map(c => `${c}▬▬▬${R}`).join("");
	lines.push(`${" ".repeat(PAD.length + 6)}${barChars}`);
	lines.push("");

	process.stdout.write(lines.join("\n") + "\n");
}
