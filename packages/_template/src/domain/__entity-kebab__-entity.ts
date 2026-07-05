/**
 * Domain entity for __Entity__. State transitions live here and return
 * domain errors instead of throwing.
 *
 * `new __Entity__Entity({...})` rehydrates trusted persisted state;
 * `__Entity__Entity.create` mints a fresh aggregate from `now`.
 */

import { err, ok, type Result } from "neverthrow";
import type { __Entity__Id } from "./__entity-kebab__-id.js";
import type { __Entity__Name } from "./__entity-kebab__-name.js";

export type __Entity__AlreadyArchived = {
  readonly type: "__Entity__AlreadyArchived";
  readonly id: __Entity__Id;
};

export interface __Entity__EntityArgs {
  readonly id: __Entity__Id;
  readonly name: __Entity__Name;
  readonly createdAt: string;
  readonly archived: boolean;
}

export interface Create__Entity__Args {
  readonly id: __Entity__Id;
  readonly name: __Entity__Name;
  /** ISO-8601 timestamp seeding `createdAt`. */
  readonly now: string;
}

export class __Entity__Entity {
  readonly id: __Entity__Id;
  readonly name: __Entity__Name;
  readonly createdAt: string;
  private _archived: boolean;

  constructor(args: __Entity__EntityArgs) {
    this.id = args.id;
    this.name = args.name;
    this.createdAt = args.createdAt;
    this._archived = args.archived;
  }

  /** Mint a fresh, unarchived aggregate. */
  static create(args: Create__Entity__Args): __Entity__Entity {
    return new __Entity__Entity({
      id: args.id,
      name: args.name,
      createdAt: args.now,
      archived: false,
    });
  }

  get archived(): boolean {
    return this._archived;
  }

  /** Archive the aggregate; rejects when already archived. */
  archive(): Result<void, __Entity__AlreadyArchived> {
    if (this._archived) return err({ type: "__Entity__AlreadyArchived", id: this.id });
    this._archived = true;
    return ok(undefined);
  }
}
