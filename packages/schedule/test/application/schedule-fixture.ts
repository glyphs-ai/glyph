import { okAsync } from "neverthrow";
import type { Logger } from "pino";
import pino from "pino";
import type { ScheduleId } from "../../src/domain/schedule/schedule-id.js";
import { ScheduleIdSchema } from "../../src/domain/schedule/schedule-id.js";
import type { ScheduleKindHandler, ScheduleModule } from "../../src/index.js";
import { composeScheduleModule, DrizzleScheduleRepository } from "../../src/index.js";
import { openTestScheduleDb } from "../testing.js";

export interface DispatchCall {
  readonly scheduleId: string;
  readonly firedAt: string;
  readonly data: unknown;
}

export interface StubHandler extends ScheduleKindHandler {
  readonly dispatchCalls: DispatchCall[];
  readonly validateCalls: Array<{ data: unknown; changedKeys?: readonly string[] }>;
  readonly mergePatchCalls: Array<{ existing: unknown; patch: unknown }>;
  readonly inFlightSet: Set<string>;
  readonly deleteCalls: string[];
  readonly deleteReturns: Map<string, { deletedCount: number }>;
  nextDispatchId: string;
}

export function makeStubHandler(): StubHandler {
  const dispatchCalls: DispatchCall[] = [];
  const validateCalls: Array<{ data: unknown; changedKeys?: readonly string[] }> = [];
  const mergePatchCalls: Array<{ existing: unknown; patch: unknown }> = [];
  const inFlightSet = new Set<string>();
  const deleteCalls: string[] = [];
  const deleteReturns = new Map<string, { deletedCount: number }>();
  let seq = 0;
  let overrideNextDispatchId: string | null = null;

  const stub: StubHandler = {
    dispatchCalls,
    validateCalls,
    mergePatchCalls,
    inFlightSet,
    deleteCalls,
    deleteReturns,
    get nextDispatchId() {
      return overrideNextDispatchId ?? `dispatch-${seq + 1}`;
    },
    set nextDispatchId(v: string) {
      overrideNextDispatchId = v;
    },
    validate(data, opts) {
      validateCalls.push({
        data,
        ...(opts?.changedKeys !== undefined ? { changedKeys: opts.changedKeys } : {}),
      });
      return okAsync(data);
    },
    mergePatch(existing, patch) {
      mergePatchCalls.push({ existing, patch });
      const e = isRecord(existing) ? existing : {};
      const p = isRecord(patch) ? patch : {};
      return { data: { ...e, ...p }, changedKeys: Object.keys(p) };
    },
    dispatch(opts) {
      dispatchCalls.push(opts);
      seq += 1;
      const id = overrideNextDispatchId ?? `dispatch-${seq}`;
      overrideNextDispatchId = null;
      return okAsync({ id });
    },
    hasInFlightForSchedule(id) {
      return okAsync(inFlightSet.has(id));
    },
    deleteForSchedule(id) {
      deleteCalls.push(id);
      return okAsync(deleteReturns.get(id) ?? { deletedCount: 0 });
    },
  };
  return stub;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface ScheduleTestHandle {
  readonly module: ScheduleModule;
  readonly repo: DrizzleScheduleRepository;
  readonly taskHandler: StubHandler;
  readonly nowRef: { value: Date };
  readonly db: Awaited<ReturnType<typeof openTestScheduleDb>>;
  setNow(d: Date): void;
  close(): Promise<void>;
}

export async function makeScheduleTestHandle(
  opts: {
    readonly initialNow?: Date;
    readonly randomUUID?: () => string;
    readonly logger?: Logger;
    readonly taskHandler?: StubHandler;
    readonly skipRegisterTask?: boolean;
  } = {},
): Promise<ScheduleTestHandle> {
  const db = await openTestScheduleDb();
  const taskHandler = opts.taskHandler ?? makeStubHandler();
  const nowRef = { value: opts.initialNow ?? new Date("2026-05-01T00:00:00.000Z") };
  const module = await composeScheduleModule({
    db: db.db,
    now: () => nowRef.value,
    ...(opts.randomUUID !== undefined ? { randomUUID: opts.randomUUID } : {}),
    ...(opts.logger !== undefined
      ? { logger: opts.logger }
      : { logger: pino({ level: "silent" }) }),
  });
  if (opts.skipRegisterTask !== true) module.engine.registerKind("task", taskHandler);
  const repo = new DrizzleScheduleRepository({ db: db.db });
  return {
    module,
    repo,
    taskHandler,
    nowRef,
    db,
    setNow(d) {
      nowRef.value = d;
    },
    async close() {
      await module.close();
      db.close();
    },
  };
}

export function fixedRandomUUID(ids: readonly string[]): () => string {
  let i = 0;
  return () => {
    const id = ids[i];
    if (id === undefined) throw new Error("fixedRandomUUID: out of ids");
    i++;
    return id;
  };
}

export const VALID_UUIDS = [
  ScheduleIdSchema.parse("550e8400-e29b-41d4-a716-446655440000"),
  ScheduleIdSchema.parse("550e8400-e29b-41d4-a716-446655440001"),
  ScheduleIdSchema.parse("550e8400-e29b-41d4-a716-446655440002"),
  ScheduleIdSchema.parse("550e8400-e29b-41d4-a716-446655440003"),
] as const satisfies readonly ScheduleId[];
