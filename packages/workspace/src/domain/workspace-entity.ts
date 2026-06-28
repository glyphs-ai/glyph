/**
 * Domain entity for `@glyphs-ai/workspace`.
 *
 * Rich domain: the entity is a class with private mutable state and
 * public mutator methods. Business state transitions (rename,
 * markOpened) live ON the entity; use-cases orchestrate
 * `repo.findById → entity.X() → repo.save(entity)` without peeking
 * inside the entity to compute the new state. Format validation
 * (name shape, id format) is the use-case schema's responsibility —
 * the entity trusts its inputs once the request schema has parsed
 * them.
 *
 * Construction:
 *   - `new WorkspaceEntity({...})` — direct construction (mapper
 *     rehydration, tests); trusts caller-supplied state.
 *   - `WorkspaceEntity.create({...})` — mint a fresh aggregate
 *     (seeds `lastOpenedAt = now`).
 *
 * Persistence ↔ entity translation lives in `WorkspaceMapper` so
 * repository code reads as pure query orchestration.
 *
 * Errors policy: this file holds the entity class only. Domain errors
 * live next to the port / layer that produces them — currently
 * registry concerns (id uniqueness, path uniqueness, registry
 * presence) all live in `workspace-repository.ts`, and infra failures
 * live in their respective adapter ports. When the entity grows a
 * state rule it can enforce alone (e.g. "can't rename an archived
 * workspace"), the corresponding `Result<void, ...>` mutator + its
 * error DU come back here.
 *
 * Distinct from the wire DTO: `lastOpenedAt` is nullable on the
 * entity (a freshly registered workspace may never have been opened
 * again); each use-case coalesces it to `createdAt` when projecting
 * its response.
 */

import type { WorkspaceId } from "./workspace-id.js";
import type { WorkspaceName } from "./workspace-name.js";

export interface CreateWorkspaceArgs {
  readonly id: WorkspaceId;
  readonly name: WorkspaceName;
  readonly workspaceDir: string;
  /** ISO-8601 timestamp; used for both `createdAt` and `lastOpenedAt`. */
  readonly now: string;
}

export class WorkspaceEntity {
  public readonly id: WorkspaceId;
  public readonly workspaceDir: string;
  private _name: WorkspaceName;
  public readonly createdAt: string;
  private _lastOpenedAt: string | null;

  /**
   * Direct construction. Used by the persistence mapper to rehydrate
   * a row, and by tests building fixtures inline. The constructor
   * trusts its inputs — schemas validate at the request boundary,
   * the mapper trusts persisted state. Any future entity-local
   * invariants (e.g. "name must be non-empty") get enforced here.
   */
  constructor(args: {
    readonly id: WorkspaceId;
    readonly workspaceDir: string;
    readonly name: WorkspaceName;
    readonly createdAt: string;
    readonly lastOpenedAt: string | null;
  }) {
    this.id = args.id;
    this.workspaceDir = args.workspaceDir;
    this._name = args.name;
    this.createdAt = args.createdAt;
    this._lastOpenedAt = args.lastOpenedAt;
  }

  get name(): WorkspaceName {
    return this._name;
  }

  get lastOpenedAt(): string | null {
    return this._lastOpenedAt;
  }

  /**
   * Mint a brand-new aggregate. `lastOpenedAt` is seeded to `now` so
   * a freshly registered workspace sorts at the top of "last opened"
   * lists — this is the business rule that justifies a factory over a
   * raw constructor call. Use-cases call this AFTER schema-validating
   * the request.
   */
  static create(args: CreateWorkspaceArgs): WorkspaceEntity {
    return new WorkspaceEntity({
      id: args.id,
      workspaceDir: args.workspaceDir,
      name: args.name,
      createdAt: args.now,
      lastOpenedAt: args.now,
    });
  }

  /**
   * Update the display name. Noop when the new name equals the
   * current one — the use-case unconditionally calls `repo.save`
   * afterwards; the redundant write is acceptable and keeps the
   * caller's surface a single linear step.
   */
  rename(newName: WorkspaceName): void {
    if (this._name === newName) return;
    this._name = newName;
  }

  /** Mark the workspace as opened at `at` (ISO-8601 stored). */
  markOpened(at: Date): void {
    this._lastOpenedAt = at.toISOString();
  }
}
