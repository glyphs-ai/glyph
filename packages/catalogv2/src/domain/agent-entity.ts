/**
 * Rich domain entity for an installed agent.
 *
 * State-transition methods return `Result<void, DomainError>` —
 * they NEVER throw. Mutation of `this` happens on the ok path only.
 *
 * Three construction entry points, each for a different upstream:
 *   - `create(id, name)`  — programmatic minimal construction with
 *                           defaults for manifest-derived fields.
 *   - `fromManifest(manifest, ctx)` — source-driven construction;
 *                           fills metadata from the manifest declarative
 *                           form and accepts install-context (id, skill
 *                           ids resolved from manifest's string refs).
 *   - `fromState(state)`  — repository rehydration; bypasses creation
 *                           invariants since the row was already valid
 *                           when last persisted.
 *
 * Knows nothing about drizzle, sql, markdown, or http.
 *
 * Visibility: class is package-internal. The public surface returns
 * read-only views from use-cases.
 */

import { err, ok, type Result } from "neverthrow";
import type {
  AgentAlreadyDisabled,
  AgentAlreadyEnabled,
  InvalidAgentName,
  InvalidManifest,
  SkillAlreadyAttached,
  SkillNotAttached,
} from "./agent-errors.js";
import type { AgentManifest } from "./agent-manifest.js";

export type AgentId = string & { readonly __brand: "AgentId" };
export type SkillId = string & { readonly __brand: "SkillId" };

export function agentId(raw: string): AgentId {
  return raw as AgentId;
}
export function skillId(raw: string): SkillId {
  return raw as SkillId;
}

export class AgentEntity {
  private constructor(
    readonly id: AgentId,
    private _name: string,
    private _description: string,
    private _version: string,
    private _enabled: boolean,
    private readonly _skills: Set<SkillId>,
  ) {}

  /** Programmatic minimal construction; defaults manifest-derived fields. */
  static create(id: AgentId, name: string): Result<AgentEntity, InvalidAgentName> {
    if (name.length === 0) {
      return err({ type: "InvalidAgentName", value: name, reason: "must be non-empty" });
    }
    return ok(new AgentEntity(id, name, "", "0.0.0", true, new Set()));
  }

  /**
   * Source-driven construction. The application calls this after the
   * source adapter has loaded + parsed an AgentManifest.
   *
   * `ctx` carries install-time state the manifest can't supply:
   *   - `id`     — the canonical AgentId (derived from manifest.name +
   *                scope at the application layer, not the manifest itself)
   *   - `skills` — resolved branded SkillIds, after application-side
   *                cross-aggregate validation against the catalog
   */
  static fromManifest(
    manifest: AgentManifest,
    ctx: { readonly id: AgentId; readonly skills: readonly SkillId[] },
  ): Result<AgentEntity, InvalidManifest> {
    if (manifest.name.length === 0) {
      return err({ type: "InvalidManifest", reason: "manifest.name must be non-empty" });
    }
    if (manifest.version.length === 0) {
      return err({ type: "InvalidManifest", reason: "manifest.version must be non-empty" });
    }
    return ok(
      new AgentEntity(
        ctx.id,
        manifest.name,
        manifest.description,
        manifest.version,
        true,
        new Set(ctx.skills),
      ),
    );
  }

  /** Mapper-only entry point: rehydrate from persisted row. No invariants re-run. */
  static fromState(state: {
    id: AgentId;
    name: string;
    description: string;
    version: string;
    enabled: boolean;
    skills: readonly SkillId[];
  }): AgentEntity {
    return new AgentEntity(
      state.id,
      state.name,
      state.description,
      state.version,
      state.enabled,
      new Set(state.skills),
    );
  }

  get name(): string {
    return this._name;
  }
  get description(): string {
    return this._description;
  }
  get version(): string {
    return this._version;
  }
  get enabled(): boolean {
    return this._enabled;
  }
  get skills(): readonly SkillId[] {
    return [...this._skills];
  }

  disable(): Result<void, AgentAlreadyDisabled> {
    if (!this._enabled) return err({ type: "AgentAlreadyDisabled", agentId: this.id });
    this._enabled = false;
    return ok(undefined);
  }

  enable(): Result<void, AgentAlreadyEnabled> {
    if (this._enabled) return err({ type: "AgentAlreadyEnabled", agentId: this.id });
    this._enabled = true;
    return ok(undefined);
  }

  rename(next: string): Result<void, InvalidAgentName> {
    if (next.length === 0) {
      return err({ type: "InvalidAgentName", value: next, reason: "must be non-empty" });
    }
    this._name = next;
    return ok(undefined);
  }

  attachSkill(skill: SkillId): Result<void, SkillAlreadyAttached> {
    if (this._skills.has(skill)) {
      return err({ type: "SkillAlreadyAttached", agentId: this.id, skillId: skill });
    }
    this._skills.add(skill);
    return ok(undefined);
  }

  detachSkill(skill: SkillId): Result<void, SkillNotAttached> {
    if (!this._skills.has(skill)) {
      return err({ type: "SkillNotAttached", agentId: this.id, skillId: skill });
    }
    this._skills.delete(skill);
    return ok(undefined);
  }
}
