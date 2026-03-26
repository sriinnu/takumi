const MAX_METRIC_SEARCH_BYTES = 64 * 1024;

function clipSearchWindow(text: string): string {
	return text.length > MAX_METRIC_SEARCH_BYTES ? text.slice(-MAX_METRIC_SEARCH_BYTES) : text;
}

function parseTabbedMetric(text: string, column: string): number | null {
	const lines = clipSearchWindow(text)
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.filter((line) => line.includes("\t"));

	for (let i = 0; i < lines.length - 1; i++) {
		const header = lines[i].split("\t").map((cell) => cell.trim());
		const columnIndex = header.indexOf(column);
		if (columnIndex === -1) continue;

		for (let rowIndex = lines.length - 1; rowIndex > i; rowIndex--) {
			const row = lines[rowIndex].split("\t").map((cell) => cell.trim());
			if (row.length <= columnIndex) continue;
			const value = Number.parseFloat(row[columnIndex]);
			if (!Number.isNaN(value)) return value;
		}
	}

	return null;
}

function parseRegexMetric(text: string, metricRegex: RegExp): number | null {
	const match = clipSearchWindow(text).match(metricRegex);
	if (!match?.[1]) return null;
	const value = Number.parseFloat(match[1]);
	return Number.isNaN(value) ? null : value;
}

export function extractAutocycleMetric(options: {
	stdout: string;
	stderr: string;
	metricColumn?: string;
	metricRegex?: RegExp;
}): number | null {
	const { stdout, stderr, metricColumn, metricRegex } = options;

	if (metricColumn) {
		for (const source of [stdout, stderr]) {
			const value = parseTabbedMetric(source, metricColumn);
			if (value !== null) return value;
		}
	}

	if (metricRegex) {
		for (const source of [stdout, stderr]) {
			const value = parseRegexMetric(source, metricRegex);
			if (value !== null) return value;
		}
	}

	return null;
}
