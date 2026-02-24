/**
 * Shared types used by message list rendering modules.
 */

export interface LineSegment {
	text: string;
	fg: number;
	bg: number;
	bold: boolean;
	dim: boolean;
	italic: boolean;
	underline: boolean;
}

export interface RenderedLine {
	text: string;
	fg: number;
	bold: boolean;
	dim: boolean;
	/** When set, render using per-segment styles instead of uniform line style. */
	segments?: LineSegment[];
}

/** Convert RGB (0-255) to a 256-color palette index. */
export function rgbTo256(r: number, g: number, b: number): number {
	return 16 + 36 * Math.round((r / 255) * 5) + 6 * Math.round((g / 255) * 5) + Math.round((b / 255) * 5);
}
