/**
 * Workspace aggregate — a pure rich-domain object. Use-cases validate
 * inputs, call entity mutators, and persist through the repository's
 * `save`. The entity carries no persistence state: the repository owns
 * change-tracking (it snapshots the row at `get` time and diffs at `save`
 * time), so the entity is unaware of INSERT-vs-UPDATE. `lastOpenedAt` is
 * nullable and response projections coalesce it to `createdAt`.
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

export interface RehydrateWorkspaceArgs {
  readonly id: WorkspaceId;
  readonly workspaceDir: string;
  readonly name: WorkspaceName;
  readonly createdAt: string;
  readonly lastOpenedAt: string | null;
}

export class WorkspaceEntity {
  public readonly id: WorkspaceId;
  public readonly workspaceDir: string;
  private _name: WorkspaceName;
  public readonly createdAt: string;
  private _lastOpenedAt: string | null;

  private constructor(args: RehydrateWorkspaceArgs) {
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

  /** Mint a new aggregate (seeds `lastOpenedAt` to `now`). */
  static create(args: CreateWorkspaceArgs): WorkspaceEntity {
    return new WorkspaceEntity({
      id: args.id,
      workspaceDir: args.workspaceDir,
      name: args.name,
      createdAt: args.now,
      lastOpenedAt: args.now,
    });
  }

  /** Rebuild a persisted aggregate from its stored fields (see the mapper). */
  static rehydrate(args: RehydrateWorkspaceArgs): WorkspaceEntity {
    return new WorkspaceEntity(args);
  }

  /** Update the display name; same-name updates are a no-op. */
  rename(newName: WorkspaceName): void {
    if (this._name === newName) return;
    this._name = newName;
  }

  /** Mark the workspace as opened at `at` (ISO-8601 stored). */
  markOpened(at: Date): void {
    this._lastOpenedAt = at.toISOString();
  }
}
