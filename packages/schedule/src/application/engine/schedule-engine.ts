import { eq } from "drizzle-orm";
import { err, ok, okAsync, type Result, ResultAsync } from "neverthrow";
import pino, { type Logger } from "pino";
import { nextRuns } from "../../domain/schedule/cron.js";
import type { ScheduleEntity } from "../../domain/schedule/schedule-entity.js";
import type { ScheduleId } from "../../domain/schedule/schedule-id.js";
import type {
  DatabaseUnavailable,
  ScheduleRepository,
} from "../../domain/schedule/schedule-repository.js";
import type { ScheduleQueries } from "../../infrastructure/drizzle/schedule-queries.js";
import type {
  HandlerFault,
  ScheduleKindHandler,
  ScheduleKindNotRegistered,
} from "../ports/schedule-kind-handler.js";
import type { ScheduleKindRegistry } from "../ports/schedule-kind-registry.js";

const silentLogger: Logger = pino({ level: "silent" });
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export interface ScheduleEngineOpts {
  readonly repo: ScheduleRepository;
  readonly queries: ScheduleQueries;
  readonly registry: ScheduleKindRegistry;
  readonly logger?: Logger;
  readonly now?: () => Date;
}

/**
 * The stateful scheduler. Owns the croner-driven arm→fire→re-arm timer chain,
 * the in-flight fire set, boot-time `recover()`, and `shutdown()`. The
 * command use-cases nudge it post-commit via {@link arm} / {@link cancel}; the
 * host drives {@link registerKind} / {@link recover} at compose time and
 * {@link shutdown} on close.
 *
 * READS go through {@link ScheduleQueries} (recover's preflight + enabled
 * scan — projection reads); the per-fire ENTITY load + WRITES go through
 * {@link ScheduleRepository}. `registerKind` / `recover` / `shutdown` are
 * lifecycle operations (compose-time / boot / close), distinct from the
 * per-request use-cases: `registerKind` and `recover` return `Result`s;
 * `shutdown` returns a plain `Promise`.
 *
 * ## Behaviour locks (not user-configurable)
 *   - concurrency = 1 (skip-and-warn on overlap; no `last_fired_at` write on a skip)
 *   - catchup-once on boot (uses the planned `firedAt`, not `now`)
 *   - no failure retry (the scheduler does not observe dispatch outcomes)
 *   - manual `run` bypasses the enabled check and does not re-arm
 *   - `patch(trigger.*)` / `patch(enabled)` re-arm; `patch(target.*)` does not
 */
export class ScheduleEngine {
  private readonly repo: ScheduleRepository;
  private readonly queries: ScheduleQueries;
  private readonly registry: ScheduleKindRegistry;
  private readonly logger: Logger;
  private readonly now: () => Date;
  private readonly timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private readonly inflight: Set<Promise<void>> = new Set();
  private shutdownCalled = false;
  private recovered = false;

  constructor(opts: ScheduleEngineOpts) {
    this.repo = opts.repo;
    this.queries = opts.queries;
    this.registry = opts.registry;
    this.logger = opts.logger ?? silentLogger;
    this.now = opts.now ?? (() => new Date());
  }

  /**
   * Register a per-kind handler. Compose-time only; delegates to the registry
   * (errs on invalid name / duplicate / frozen). MUST precede {@link recover}.
   */
  registerKind(
    kind: string,
    handler: ScheduleKindHandler,
  ): ReturnType<ScheduleKindRegistry["register"]> {
    return this.registry.register(kind, handler);
  }

  /**
   * Boot-time recovery. Freezes the registry on first call, preflights every
   * row's `target_kind` against the registry (any unregistered kind — on an
   * enabled OR disabled row — errs with {@link ScheduleKindNotRegistered}),
   * then for every enabled schedule:
   *   - `next_fire_at` in the past → catchup-fire EXACTLY ONCE with the planned
   *     (past) `firedAt`, then re-arm the next tick from `now`. Multiple missed
   *     fires collapse into one.
   *   - `next_fire_at` in the future (or unset) → just arm.
   * Disabled schedules are skipped after the preflight. Idempotent: once the
   * registry is frozen, repeated calls return `ok` immediately.
   *
   * **On preflight failure the registry stays frozen.** The only correct
   * recovery is to dispose the module via `composeScheduleModule(...).close()`
   * and rebuild.
   */
  recover(): ResultAsync<void, ScheduleKindNotRegistered | DatabaseUnavailable> {
    if (this.recovered) return okAsync(undefined);
    this.recovered = true;
    this.registry.freeze();
    return new ResultAsync(this.doRecover());
  }

  private async doRecover(): Promise<
    Result<void, ScheduleKindNotRegistered | DatabaseUnavailable>
  > {
    // Preflight: every row's kind must be registered. Project just
    // (id, targetKind) so a workspace with thousands of disabled rows doesn't
    // pull every blob into memory.
    const preflight = await this.queries.query(
      async (db) =>
        await db
          .select({ id: this.queries.schedules.id, targetKind: this.queries.schedules.targetKind })
          .from(this.queries.schedules)
          .all(),
    );
    if (preflight.isErr()) return err(preflight.error);
    for (const row of preflight.value) {
      if (!this.registry.has(row.targetKind)) {
        return err({ type: "ScheduleKindNotRegistered", kind: row.targetKind });
      }
    }

    // Arm scan: the enabled schedule ids, loaded as entities via findById so
    // the catchup path can fire + save them.
    const enabled = await this.queries.query(
      async (db) =>
        await db
          .select({ id: this.queries.schedules.id })
          .from(this.queries.schedules)
          .where(eq(this.queries.schedules.enabled, true))
          .all(),
    );
    if (enabled.isErr()) return err(enabled.error);

    const now = this.now();
    for (const { id } of enabled.value) {
      const scheduleId = id as ScheduleId;
      const found = await this.repo.get(scheduleId);
      if (found.isErr()) {
        // A schedule deleted between the scan and this load is a normal race —
        // skip it silently; only a real IO / corruption fault is worth a warn.
        if (found.error.type !== "ScheduleNotFound") {
          this.logger.warn(
            { scheduleId, err: found.error },
            "schedule recover: row load failed, continuing with remaining rows",
          );
        }
        continue;
      }
      const entity = found.value;
      if (!entity.enabled) continue;
      await this.recoverOne(entity, now);
    }
    return ok(undefined);
  }

  private async recoverOne(entity: ScheduleEntity, now: Date): Promise<void> {
    const handlerResult = this.registry.handlerFor(entity.target.kind);
    if (handlerResult.isErr()) {
      this.logger.warn(
        { scheduleId: entity.id, kind: entity.target.kind },
        "schedule recover: no handler registered for kind, skipping catchup",
      );
      return;
    }
    if (entity.nextFireAt !== undefined && new Date(entity.nextFireAt).getTime() <= now.getTime()) {
      const plannedFiredAt = entity.nextFireAt;
      const dispatched = await this.dispatch(handlerResult.value, entity, plannedFiredAt);
      if (dispatched.isErr()) {
        this.logger.warn(
          { scheduleId: entity.id, err: dispatched.error.cause },
          "schedule recover: catchup dispatch failed",
        );
      } else {
        const [nextIso] = nextRuns(entity.trigger.expr, entity.trigger.tz, now, 1);
        entity.recordFired(plannedFiredAt, nextIso);
        await this.persist(entity);
      }
    }
    const fresh = await this.repo.get(entity.id);
    if (fresh.isOk() && fresh.value.enabled) this.armNext(fresh.value);
  }

  /** Clear all timers and await any in-flight fires. Called by `module.close()`. */
  async shutdown(): Promise<void> {
    this.shutdownCalled = true;
    for (const handle of this.timers.values()) clearTimeout(handle);
    this.timers.clear();
    if (this.inflight.size > 0) await Promise.allSettled([...this.inflight]);
  }

  /** Post-commit nudge from Create / Patch: (re)arm this schedule's timer. */
  arm(entity: ScheduleEntity): void {
    this.cancelTimer(entity.id);
    this.armNext(entity);
  }

  /** Post-commit nudge from Patch(disable) / Delete: cancel this schedule's timer. */
  cancel(id: ScheduleId): void {
    this.cancelTimer(id);
  }

  // ─── Internals ────────────────────────────────────────────

  private armNext(entity: ScheduleEntity): void {
    if (this.shutdownCalled) return;
    if (!entity.enabled) return;
    const now = this.now();
    const [computedIso] =
      entity.nextFireAt === undefined
        ? nextRuns(entity.trigger.expr, entity.trigger.tz, now, 1)
        : [];
    const iso = entity.nextFireAt ?? computedIso;
    if (iso === undefined) return;
    const delay = new Date(iso).getTime() - now.getTime();
    const timeoutDelay = Math.max(0, Math.min(delay, MAX_TIMER_DELAY_MS));
    const id = entity.id;
    const handle = setTimeout(() => {
      if (delay > MAX_TIMER_DELAY_MS) {
        void this.rearmNext(id, iso);
      } else {
        const p = this.fire(id);
        this.inflight.add(p);
        void p.finally(() => this.inflight.delete(p));
      }
    }, timeoutDelay);
    this.timers.set(id, handle);
  }

  private async rearmNext(id: ScheduleId, plannedIso: string): Promise<void> {
    this.timers.delete(id);
    if (this.shutdownCalled) return;
    const found = await this.repo.get(id);
    if (found.isOk() && found.value.enabled) {
      found.value.withNextFireAt(found.value.nextFireAt ?? plannedIso);
      this.armNext(found.value);
    }
  }

  /**
   * Tick handler. Re-reads the latest entity (it may have been patched while
   * sleeping), runs the concurrency check via the kind handler, dispatches,
   * records the fire, re-arms.
   */
  private async fire(id: ScheduleId): Promise<void> {
    this.timers.delete(id);
    if (this.shutdownCalled) return;
    const found = await this.repo.get(id);
    if (found.isErr()) {
      // A schedule deleted while its timer slept is a normal race — skip
      // silently; only a real IO / corruption fault is worth a warn.
      if (found.error.type !== "ScheduleNotFound") {
        this.logger.warn({ scheduleId: id, err: found.error }, "schedule fire: row load failed");
      }
      return;
    }
    const entity = found.value;
    if (!entity.enabled) return;
    const handlerResult = this.registry.handlerFor(entity.target.kind);
    if (handlerResult.isErr()) {
      this.logger.warn(
        { scheduleId: entity.id, kind: entity.target.kind },
        "schedule fire: no handler registered for kind",
      );
      return;
    }
    const handler = handlerResult.value;
    const inFlight = await handler.hasInFlightForSchedule(entity.id);
    if (inFlight.isErr()) {
      this.logger.warn(
        { scheduleId: entity.id, err: inFlight.error.cause },
        "schedule fire: in-flight check failed",
      );
      return;
    }
    if (inFlight.value) {
      this.logger.warn(
        { scheduleId: entity.id },
        "schedule fire skipped (previous dispatch still running)",
      );
      const [nextIso] = nextRuns(entity.trigger.expr, entity.trigger.tz, this.now(), 1);
      entity.withNextFireAt(nextIso);
      await this.persist(entity);
      this.armNext(entity);
      return;
    }
    const firedAt = this.now().toISOString();
    const dispatched = await this.dispatch(handler, entity, firedAt);
    if (dispatched.isErr()) {
      this.logger.warn(
        { scheduleId: entity.id, err: dispatched.error.cause },
        "schedule fire: dispatch failed",
      );
      // No failure retry: record the fire and re-arm.
    }
    if (this.shutdownCalled) return;
    const [nextIso] = nextRuns(entity.trigger.expr, entity.trigger.tz, this.now(), 1);
    entity.recordFired(firedAt, nextIso);
    await this.persist(entity);
    this.armNext(entity);
  }

  /**
   * Route the fire through the given kind handler. Trusts the envelope's
   * `data` (validated at create / patch time). The caller resolves the handler
   * via {@link ScheduleKindRegistry.handlerFor} and passes it in.
   */
  private dispatch(
    handler: ScheduleKindHandler,
    entity: ScheduleEntity,
    firedAt: string,
  ): ResultAsync<string, HandlerFault> {
    return handler
      .dispatch({ scheduleId: entity.id, firedAt, data: entity.target.data })
      .map((dispatched) => dispatched.id);
  }

  private async persist(entity: ScheduleEntity): Promise<void> {
    const saved = await this.repo.save(entity);
    if (saved.isErr()) {
      this.logger.warn({ scheduleId: entity.id, err: saved.error }, "schedule: persist failed");
    }
  }

  private cancelTimer(id: ScheduleId): void {
    const handle = this.timers.get(id);
    if (handle !== undefined) {
      clearTimeout(handle);
      this.timers.delete(id);
    }
  }
}
