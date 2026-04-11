import type { DaemonSocketClient } from "./daemon-socket.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function readNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean {
	return value === true;
}

/** I describe the masked daemon-owned token record one vertical receives back from auth operations. */
export interface VerticalAuthTokenRecord {
	kind: "verifier" | "binding";
	verticalId: string;
	record: {
		id: string;
		key: string;
		name: string;
		tenantId: string;
		scopes: string[];
		createdAt: number;
		expiresAt?: number;
		lastUsedAt?: number;
		rateLimit?: number;
	};
}

/** I describe the operator-supplied knobs for verifier issuance and rotation. */
export interface VerticalAuthTokenOptions {
	name?: string;
	scopes?: string[];
	expiresAt?: number;
	rateLimit?: number;
}

/** I describe the short-lived binding-token exchange request. */
export interface VerticalAuthExchangeOptions {
	name?: string;
	scopes?: string[];
	ttlMs?: number;
	rateLimit?: number;
}

/** I describe one verifier-token rotation request. */
export interface VerticalAuthRotateOptions extends VerticalAuthTokenOptions {
	revokePrevious?: boolean;
}

/** I capture the daemon response when one vertical token is issued or rotated. */
export interface VerticalAuthIssuedTokenResult {
	kind: "verifier" | "binding";
	verticalId: string;
	key: string;
	record: VerticalAuthTokenRecord["record"];
	issuedForKeyId?: string | null;
	expiresAt?: number;
	replacedKeyId?: string;
	revokedPrevious?: boolean;
}

/** I capture the list payload for masked vertical tokens. */
export interface VerticalAuthListResult {
	tokens: VerticalAuthTokenRecord[];
}

/** I capture the introspection response for one vertical token. */
export interface VerticalAuthIntrospectResult {
	found: boolean;
	token: VerticalAuthTokenRecord | null;
}

/** I capture the revoke response for one vertical token. */
export interface VerticalAuthRevokeResult {
	revoked: boolean;
	keyId: string;
	token: VerticalAuthTokenRecord | null;
}

function readTokenRecord(value: unknown): VerticalAuthTokenRecord | null {
	if (!isRecord(value) || !isRecord(value.record)) return null;
	const kind = value.kind === "verifier" || value.kind === "binding" ? value.kind : null;
	const verticalId = readString(value.verticalId);
	const id = readString(value.record.id);
	const key = readString(value.record.key);
	const name = readString(value.record.name);
	const tenantId = readString(value.record.tenantId);
	const createdAt = readNumber(value.record.createdAt);
	if (!kind || !verticalId || !id || !key || !name || !tenantId || createdAt == null) return null;
	return {
		kind,
		verticalId,
		record: {
			id,
			key,
			name,
			tenantId,
			scopes: readStringArray(value.record.scopes),
			createdAt,
			...(readNumber(value.record.expiresAt) != null ? { expiresAt: readNumber(value.record.expiresAt)! } : {}),
			...(readNumber(value.record.lastUsedAt) != null ? { lastUsedAt: readNumber(value.record.lastUsedAt)! } : {}),
			...(readNumber(value.record.rateLimit) != null ? { rateLimit: readNumber(value.record.rateLimit)! } : {}),
		},
	};
}

function readIssuedTokenResult(value: unknown): VerticalAuthIssuedTokenResult {
	if (!isRecord(value)) {
		throw new Error("vertical auth response is invalid");
	}
	const kind = value.kind === "verifier" || value.kind === "binding" ? value.kind : null;
	const verticalId = readString(value.verticalId);
	const key = readString(value.key);
	const record = readTokenRecord({ kind: value.kind, verticalId: value.verticalId, record: value.record })?.record;
	if (!kind || !verticalId || !key || !record) {
		throw new Error("vertical auth response is missing token data");
	}
	return {
		kind,
		verticalId,
		key,
		record,
		...(readString(value.issuedForKeyId) !== null ? { issuedForKeyId: readString(value.issuedForKeyId) } : {}),
		...(readNumber(value.expiresAt) != null ? { expiresAt: readNumber(value.expiresAt)! } : {}),
		...(readString(value.replacedKeyId) !== null ? { replacedKeyId: readString(value.replacedKeyId)! } : {}),
		...(typeof value.revokedPrevious === "boolean" ? { revokedPrevious: value.revokedPrevious } : {}),
	};
}

/** I issue one long-lived verifier token for a vertical. */
export async function verticalAuthIssue(
	socket: DaemonSocketClient | null,
	verticalId: string,
	options: VerticalAuthTokenOptions = {},
): Promise<VerticalAuthIssuedTokenResult | null> {
	if (!socket?.isConnected) return null;
	const raw = await socket.call("vertical.auth.issue", { verticalId, ...options });
	return readIssuedTokenResult(raw);
}

/** I exchange the current authenticated verifier token for a shorter-lived binding token. */
export async function verticalAuthExchange(
	socket: DaemonSocketClient | null,
	options: VerticalAuthExchangeOptions = {},
): Promise<VerticalAuthIssuedTokenResult | null> {
	if (!socket?.isConnected) return null;
	const raw = await socket.call("vertical.auth.exchange", { ...options });
	return readIssuedTokenResult(raw);
}

/** I rotate one verifier token and optionally revoke the previous verifier. */
export async function verticalAuthRotate(
	socket: DaemonSocketClient | null,
	keyId: string,
	options: VerticalAuthRotateOptions = {},
): Promise<VerticalAuthIssuedTokenResult | null> {
	if (!socket?.isConnected) return null;
	const raw = await socket.call("vertical.auth.rotate", { keyId, ...options });
	return readIssuedTokenResult(raw);
}

/** I list masked verifier and binding tokens for one vertical or the whole registry. */
export async function verticalAuthList(
	socket: DaemonSocketClient | null,
	verticalId?: string,
): Promise<VerticalAuthListResult | null> {
	if (!socket?.isConnected) return null;
	const raw = await socket.call<Record<string, unknown>>("vertical.auth.list", verticalId ? { verticalId } : {});
	if (!isRecord(raw)) {
		throw new Error("vertical.auth.list returned an invalid payload");
	}
	return {
		tokens: Array.isArray(raw.tokens)
			? raw.tokens.map(readTokenRecord).filter((token): token is VerticalAuthTokenRecord => token !== null)
			: [],
	};
}

/** I introspect one masked verifier or binding token by key id. */
export async function verticalAuthIntrospect(
	socket: DaemonSocketClient | null,
	keyId: string,
): Promise<VerticalAuthIntrospectResult | null> {
	if (!socket?.isConnected) return null;
	const raw = await socket.call<Record<string, unknown>>("vertical.auth.introspect", { keyId });
	if (!isRecord(raw)) {
		throw new Error("vertical.auth.introspect returned an invalid payload");
	}
	return {
		found: readBoolean(raw.found),
		token: readTokenRecord(raw.token),
	};
}

/** I revoke one verifier or binding token by key id. */
export async function verticalAuthRevoke(
	socket: DaemonSocketClient | null,
	keyId: string,
): Promise<VerticalAuthRevokeResult | null> {
	if (!socket?.isConnected) return null;
	const raw = await socket.call<Record<string, unknown>>("vertical.auth.revoke", { keyId });
	if (!isRecord(raw)) {
		throw new Error("vertical.auth.revoke returned an invalid payload");
	}
	return {
		revoked: readBoolean(raw.revoked),
		keyId: readString(raw.keyId) ?? keyId,
		token: readTokenRecord(raw.token),
	};
}
