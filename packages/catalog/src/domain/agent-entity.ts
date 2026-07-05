/**
 * Domain entity for an installed agent.
 *
 * Identity is `fqn` (`<scope>/<name>`); `origin` is provenance. The entity
 * owns enable/disable state transitions and returns domain errors instead
 * of throwing. `dependencyRefs` stores declared origins from the manifest.
 *
 * `new AgentEntity({...})` rehydrates trusted inputs. `AgentEntity.create`
 * mints an enabled aggregate with timestamps seeded from `now`.
 */

import { err, ok, type Result } from "neverthrow";
import type { AgentDependencyRefs } from "./agent-deps.js";
import { AgentFqn, type AgentName, type AgentScope } from "./agent-fqn.js";

export type AgentAlreadyDisabled = {
  readonly type: "AgentAlreadyDisabled";
  readonly fqn: string;
};
export type AgentAlreadyEnabled = {
  readonly type: "AgentAlreadyEnabled";
  readonly fqn: string;
};
const EMPTY_DEPS: AgentDependencyRefs = { skills: [], mcps: [], agents: [] };

export interface AgentEntityArgs {
  readonly fqn: AgentFqn;
  readonly origin: string;
  readonly description: string;
  readonly version: string;
  readonly prereqs: string | undefined;
  readonly prereqsAck: boolean;
  readonly disabledByUser: boolean;
  readonly dependencyRefs: AgentDependencyRefs;
  readonly installedAt: string;
  readonly updatedAt: string;
}

export interface CreateAgentArgs {
  readonly scope: AgentScope;
  readonly name: AgentName;
  readonly origin: string;
  readonly description: string;
  readonly version: string;
  readonly prereqs: string | undefined;
  readonly dependencyRefs: AgentDependencyRefs;
  /** ISO-8601 timestamp; seeds both `installedAt` and `updatedAt`. */
  readonly now: string;
}

export class AgentEntity {
  readonly fqn: AgentFqn;
  readonly origin: string;
  readonly description: string;
  readonly version: string;
  readonly prereqs: string | undefined;
  readonly dependencyRefs: AgentDependencyRefs;
  readonly installedAt: string;
  readonly updatedAt: string;
  private _disabledByUser: boolean;
  private _prereqsAck: boolean;

  constructor(args: AgentEntityArgs) {
    this.fqn = args.fqn;
    this.origin = args.origin;
    this.description = args.description;
    this.version = args.version;
    this.prereqs = args.prereqs;
    this.dependencyRefs = args.dependencyRefs;
    this.installedAt = args.installedAt;
    this.updatedAt = args.updatedAt;
    this._disabledByUser = args.disabledByUser;
    this._prereqsAck = args.prereqsAck;
  }

  /** Mint a fresh aggregate — enabled; no prereqs is auto-acknowledged. */
  static create(args: CreateAgentArgs): AgentEntity {
    return new AgentEntity({
      fqn: AgentFqn.create(args.scope, args.name),
      origin: args.origin,
      description: args.description,
      version: args.version,
      prereqs: args.prereqs,
      prereqsAck: (args.prereqs ?? "").trim().length === 0,
      disabledByUser: false,
      dependencyRefs: args.dependencyRefs ?? EMPTY_DEPS,
      installedAt: args.now,
      updatedAt: args.now,
    });
  }

  /** Identity alias — the fqn IS the id. */
  get id(): AgentFqn {
    return this.fqn;
  }
  get disabledByUser(): boolean {
    return this._disabledByUser;
  }
  get prereqsAck(): boolean {
    return this._prereqsAck;
  }

  disable(): Result<void, AgentAlreadyDisabled> {
    if (this._disabledByUser) return err({ type: "AgentAlreadyDisabled", fqn: this.id });
    this._disabledByUser = true;
    return ok(undefined);
  }

  enable(): Result<void, AgentAlreadyEnabled> {
    if (!this._disabledByUser) return err({ type: "AgentAlreadyEnabled", fqn: this.id });
    this._disabledByUser = false;
    return ok(undefined);
  }

  acknowledgePrereqs(): void {
    this._prereqsAck = true;
  }
}
