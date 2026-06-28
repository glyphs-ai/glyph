import { randomBytes } from "node:crypto";
import { __Entity__NotFoundError } from "../contract/__entity-kebab__.errors.js";
import {
  __Entity__IdSchema,
  Create__Entity__RequestSchema,
} from "../contract/__entity-kebab__.schemas.js";
import type {
  __Entity__,
  Create__Entity__Request,
  List__Entity__Opts,
} from "../contract/__entity-kebab__.types.js";
import type { __Entity__Entity } from "../domain/__entity-kebab__.entity.js";
import type { __Entity__Repository } from "../persistence/__entity-kebab__.repository.js";

/**
 * Dependencies for {@link __Entity__Service}, injected as one named bag:
 * the repository plus an optional clock seam. See `docs/pkg-template.md`
 * "Parameter & constructor shape".
 */
export interface __Entity__ServiceOpts {
  readonly repo: __Entity__Repository;
  /** Injectable clock so tests get a deterministic `createdAt`. */
  readonly now?: () => Date;
}

/**
 * Public surface for `@glyphs-ai/__PKG__`. Holds both reads (get / list)
 * and writes (create / delete). All methods return wire-shape DTOs
 * (`__Entity__`).
 *
 * One class per BC — there is no Queries/Service split. The service is a
 * thin orchestrator over `__Entity__Repository`: reads delegate to the
 * repository (which returns `__Entity__Entity`, the pkg-owned domain
 * shape) and the service returns the wire `__Entity__` DTO — here a
 * structural identity, so no explicit projection helper; grow it into a
 * spread with per-field normalisation when a field needs coercion at the
 * wire boundary. Writes own id minting and input validation (via the zod
 * schemas in `contract/`); a malformed input raises a `ZodError`.
 *
 * The clock is injectable (`now`) so tests get deterministic
 * `createdAt`. See `docs/pkg-template.md` "Test seams".
 */
export class __Entity__Service {
  private readonly repo: __Entity__Repository;
  private readonly now: () => Date;

  constructor(opts: __Entity__ServiceOpts) {
    this.repo = opts.repo;
    this.now = opts.now ?? (() => new Date());
  }

  // ─── Reads ─────────────────────────────────────────────

  async get(id: string): Promise<__Entity__ | null> {
    __Entity__IdSchema.parse(id);
    return (await this.repo.findById(id)) ?? null;
  }

  async list(opts: List__Entity__Opts = {}): Promise<__Entity__[]> {
    return this.repo.findAll(opts);
  }

  // ─── Writes ────────────────────────────────────────────

  async create(input: Create__Entity__Request): Promise<__Entity__> {
    const { name } = Create__Entity__RequestSchema.parse(input);
    const now = this.now().toISOString();
    const id = randomBytes(8).toString("hex");
    const entity: __Entity__Entity = { id, name, createdAt: now };
    await this.repo.insert(entity);
    return entity;
  }

  async delete(id: string): Promise<void> {
    __Entity__IdSchema.parse(id);
    const existing = await this.repo.findById(id);
    if (existing === undefined) throw new __Entity__NotFoundError(id);
    await this.repo.delete(id);
  }
}
