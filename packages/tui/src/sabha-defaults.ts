import type { SabhaParticipantSpec } from "@takumi/bridge";

export const DEFAULT_SABHA_CONVENER = "takumi";
export const DEFAULT_SABHA_ASKER = "takumi.mesh";

export const DEFAULT_SABHA_PARTICIPANTS: SabhaParticipantSpec[] = [
	{ id: "planner", role: "planner", expertise: 0.9, credibility: 0.8 },
	{ id: "validator", role: "validator", expertise: 0.95, credibility: 0.9 },
	{ id: "scarlett", role: "integrity", expertise: 1, credibility: 1 },
];

export function formatDefaultSabhaSummary(): string {
	return [
		"## Default Sabha",
		`• Convener: ${DEFAULT_SABHA_CONVENER}`,
		`• Asker: ${DEFAULT_SABHA_ASKER}`,
		"• Default council:",
		...DEFAULT_SABHA_PARTICIPANTS.map(
			(participant) =>
				`  - ${participant.id} — ${participant.role} (expertise ${participant.expertise?.toFixed(2) ?? "n/a"}, credibility ${participant.credibility?.toFixed(2) ?? "n/a"})`,
		),
	].join("\n");
}
