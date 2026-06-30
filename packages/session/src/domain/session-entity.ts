/**
 * Domain entity for a session — the persisted slice. Live fields
 * (workdir / lastActiveAt / preview) are NOT stored here; they are
 * projected per-read from the runtime + workspace layout.
 *
 * `new SessionEntity({...})` rehydrates persisted rows;
 * `SessionEntity.create` mints a fresh aggregate.
 */

import type { SessionId } from "./session-id.js";

export type LaunchMode = "local" | "remote";

export interface SessionEntityArgs {
  readonly id: SessionId;
  readonly agent: string;
  readonly runtime: string;
  readonly createdAt: string;
  readonly runtimeSessionId: string | null;
  readonly lastLaunchMode: LaunchMode | null;
}

export interface CreateSessionEntityArgs {
  readonly id: SessionId;
  readonly agent: string;
  readonly runtime: string;
  readonly runtimeSessionId: string | null;
  /** ISO-8601 timestamp seeding `createdAt`. */
  readonly now: string;
}

export class SessionEntity {
  readonly id: SessionId;
  readonly agent: string;
  readonly runtime: string;
  readonly createdAt: string;
  readonly runtimeSessionId: string | null;
  private _lastLaunchMode: LaunchMode | null;

  constructor(args: SessionEntityArgs) {
    this.id = args.id;
    this.agent = args.agent;
    this.runtime = args.runtime;
    this.createdAt = args.createdAt;
    this.runtimeSessionId = args.runtimeSessionId;
    this._lastLaunchMode = args.lastLaunchMode;
  }

  /** Mint a fresh, never-launched session aggregate. */
  static create(args: CreateSessionEntityArgs): SessionEntity {
    return new SessionEntity({
      id: args.id,
      agent: args.agent,
      runtime: args.runtime,
      createdAt: args.now,
      runtimeSessionId: args.runtimeSessionId,
      lastLaunchMode: null,
    });
  }

  get lastLaunchMode(): LaunchMode | null {
    return this._lastLaunchMode;
  }

  /** Record the mode of the most recent interactive launch. */
  markLaunched(mode: LaunchMode): void {
    this._lastLaunchMode = mode;
  }
}
