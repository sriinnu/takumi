/**
 * Authority leasing for multi-agent cluster coordination.
 * Provides exclusive ownership semantics over shared resources
 * (worktrees, files, branches) so only one agent holds a lease at a time.
 *
 * Inspired by oh-my-codex's AuthorityLease pattern.
 * @module
 */

import { randomUUID } from "node:crypto";

/** I describe a single held lease on a shared resource. */
export interface AuthorityLease {
	leaseId: string;
	owner: string;
	resource: string;
	acquiredAt: number;
	expiresAt: number;
	stale: boolean;
}

/** I enumerate the reasons a lease operation can fail. */
export type LeaseErrorCode = "already_held" | "owner_mismatch" | "not_held" | "expired";

/** I represent a lease operation failure with a typed error code. */
export class LeaseError extends Error {
	readonly code: LeaseErrorCode;
	readonly holder?: string;

	constructor(code: LeaseErrorCode, message: string, holder?: string) {
		super(message);
		this.name = "LeaseError";
		this.code = code;
		this.holder = holder;
	}
}

/** Default lease duration — 60 seconds. Agents should renew periodically. */
const DEFAULT_LEASE_MS = 60_000;

/**
 * I manage exclusive authority leases over shared resources.
 *
 * Each resource can be held by exactly one owner at a time.
 * Leases auto-expire after their duration unless renewed, and expired
 * leases are treated as released for new acquire calls.
 */
export class AuthorityLeaseManager {
	private readonly leases = new Map<string, AuthorityLease>();

	/** I acquire a lease on a resource for an owner. Throws LeaseError if already held by another. */
	acquire(resource: string, owner: string, durationMs: number = DEFAULT_LEASE_MS): AuthorityLease {
		const existing = this.leases.get(resource);
		if (existing && !this.isExpiredLease(existing)) {
			if (existing.owner === owner) {
				// Same owner re-acquiring — just renew in place.
				return this.renewLease(existing, durationMs);
			}
			throw new LeaseError(
				"already_held",
				`Resource "${resource}" is already held by "${existing.owner}"`,
				existing.owner,
			);
		}

		const now = Date.now();
		const lease: AuthorityLease = {
			leaseId: randomUUID(),
			owner,
			resource,
			acquiredAt: now,
			expiresAt: now + durationMs,
			stale: false,
		};
		this.leases.set(resource, lease);
		return { ...lease };
	}

	/** I renew an existing lease. Throws if owner doesn't match or lease doesn't exist. */
	renew(resource: string, owner: string, durationMs: number = DEFAULT_LEASE_MS): AuthorityLease {
		const existing = this.leases.get(resource);
		if (!existing) {
			throw new LeaseError("not_held", `No lease exists for resource "${resource}"`);
		}
		if (this.isExpiredLease(existing)) {
			throw new LeaseError("expired", `Lease for resource "${resource}" has expired`);
		}
		if (existing.owner !== owner) {
			throw new LeaseError(
				"owner_mismatch",
				`Resource "${resource}" is held by "${existing.owner}", not "${owner}"`,
				existing.owner,
			);
		}
		return this.renewLease(existing, durationMs);
	}

	/** I release a lease. Only the owner can release. Throws on mismatch. */
	release(resource: string, owner: string): void {
		const existing = this.leases.get(resource);
		if (!existing) {
			throw new LeaseError("not_held", `No lease exists for resource "${resource}"`);
		}
		if (existing.owner !== owner) {
			throw new LeaseError(
				"owner_mismatch",
				`Resource "${resource}" is held by "${existing.owner}", not "${owner}"`,
				existing.owner,
			);
		}
		this.leases.delete(resource);
	}

	/** I force-release a lease regardless of owner. Used for recovery. */
	forceRelease(resource: string): void {
		this.leases.delete(resource);
	}

	/** I mark a lease as stale (owner may be dead). Returns true if a lease existed. */
	markStale(resource: string): boolean {
		const existing = this.leases.get(resource);
		if (!existing) return false;
		existing.stale = true;
		return true;
	}

	/** I clear all stale leases. Returns count of cleared leases. */
	clearStale(): number {
		let count = 0;
		for (const [resource, lease] of this.leases) {
			if (lease.stale) {
				this.leases.delete(resource);
				count++;
			}
		}
		return count;
	}

	/** I clear expired leases. Returns count of cleared leases. */
	clearExpired(): number {
		let count = 0;
		for (const [resource, lease] of this.leases) {
			if (this.isExpiredLease(lease)) {
				this.leases.delete(resource);
				count++;
			}
		}
		return count;
	}

	/** I return the current lease for a resource, or null if none or expired. */
	inspect(resource: string): AuthorityLease | null {
		const existing = this.leases.get(resource);
		if (!existing || this.isExpiredLease(existing)) return null;
		return { ...existing };
	}

	/** I return all currently held (non-expired) leases. */
	snapshot(): AuthorityLease[] {
		const now = Date.now();
		const result: AuthorityLease[] = [];
		for (const lease of this.leases.values()) {
			if (lease.expiresAt > now) {
				result.push({ ...lease });
			}
		}
		return result;
	}

	/** I return true if the resource is leased and not expired. */
	isHeld(resource: string): boolean {
		const existing = this.leases.get(resource);
		return !!existing && !this.isExpiredLease(existing);
	}

	/** I check whether a lease has passed its expiry time. */
	private isExpiredLease(lease: AuthorityLease): boolean {
		return Date.now() >= lease.expiresAt;
	}

	/** I extend a lease's expiry in place and return a snapshot. */
	private renewLease(lease: AuthorityLease, durationMs: number): AuthorityLease {
		lease.expiresAt = Date.now() + durationMs;
		lease.stale = false;
		return { ...lease };
	}
}
