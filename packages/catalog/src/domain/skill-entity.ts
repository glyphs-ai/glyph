/**
 * Domain entity for an installed skill.
 *
 * Identity = `fqn` (`<scope>/<short>`); `origin` is provenance. Unlike
 * mcp, skill is a rich entity: it owns one real state transition,
 * `acknowledgePrereqs`, that it can decide alone. File bytes (SKILL.md +
 * tree) are NOT held here — the repository persists/streams them; the
 * entity carries metadata + the prereq-ack flag + declared dep origins.
 *
 * Construction (workspace two-door pattern): `new SkillEntity({...})`
 * trusts inputs (mapper rehydration, install after schema validation),
 * `SkillEntity.create({...})` mints a fresh aggregate (seeds prereqsAck:
 * a skill with no prereqs is auto-acked, timestamps default to `now`).
 * Format validation is the manifest/request schema's job.
 */

import type { SkillDependencyRefs } from "./skill-deps.js";
import { SkillFqn, type SkillName, type SkillScope } from "./skill-fqn.js";

export interface SkillEntityArgs {
  readonly fqn: SkillFqn;
  readonly origin: string;
  readonly description: string;
  readonly version: string;
  readonly prereqs: string | undefined;
  readonly prereqsAck: boolean;
  readonly dependencyRefs: SkillDependencyRefs;
  readonly installedAt: string;
  readonly updatedAt: string;
}

export interface CreateSkillArgs {
  readonly scope: SkillScope;
  readonly name: SkillName;
  readonly origin: string;
  readonly description: string;
  readonly version: string;
  readonly prereqs: string | undefined;
  readonly dependencyRefs: SkillDependencyRefs;
  /** ISO-8601 timestamp; seeds both `installedAt` and `updatedAt`. */
  readonly now: string;
}

export class SkillEntity {
  public readonly fqn: SkillFqn;
  public readonly origin: string;
  public readonly description: string;
  public readonly version: string;
  public readonly prereqs: string | undefined;
  public readonly dependencyRefs: SkillDependencyRefs;
  public readonly installedAt: string;
  public readonly updatedAt: string;
  private _prereqsAck: boolean;

  constructor(args: SkillEntityArgs) {
    this.fqn = args.fqn;
    this.origin = args.origin;
    this.description = args.description;
    this.version = args.version;
    this.prereqs = args.prereqs;
    this.dependencyRefs = args.dependencyRefs;
    this.installedAt = args.installedAt;
    this.updatedAt = args.updatedAt;
    this._prereqsAck = args.prereqsAck;
  }

  /** Mint a fresh aggregate — a skill with no prereqs is auto-acknowledged. */
  static create(args: CreateSkillArgs): SkillEntity {
    return new SkillEntity({
      fqn: SkillFqn.create(args.scope, args.name),
      origin: args.origin,
      description: args.description,
      version: args.version,
      prereqs: args.prereqs,
      dependencyRefs: args.dependencyRefs,
      prereqsAck: (args.prereqs ?? "").trim().length === 0,
      installedAt: args.now,
      updatedAt: args.now,
    });
  }

  /** Identity alias — the fqn IS the id. */
  get id(): SkillFqn {
    return this.fqn;
  }

  get prereqsAck(): boolean {
    return this._prereqsAck;
  }

  /**
   * Mark the prerequisites as acknowledged. Idempotent — the use-case
   * unconditionally saves afterwards; a redundant write is acceptable.
   */
  acknowledgePrereqs(): void {
    this._prereqsAck = true;
  }
}
