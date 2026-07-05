import { err, ok, type Result } from "neverthrow";
import type { TaskCancellation } from "../../domain/task-cancellation.js";
import { type CorruptedTask, TaskEntity } from "../../domain/task-entity.js";
import type { TaskFailure } from "../../domain/task-failure.js";
import type { TaskOrigin } from "../../domain/task-origin.js";
import type { TaskStatus } from "../../domain/task-status.js";
import type { TaskSuccess } from "../../domain/task-success.js";
import type { NewTaskRow, TaskRow } from "./task-schema.js";

/**
 * Row ↔ entity mapper for the `tasks` table. `metadata.runtime` is promoted
 * out of the JSON bag into the first-class indexed `runtime` column on
 * write and folded back in on read; terminal payloads are JSON-encoded.
 * `toEntity` returns `CorruptedTask` for unparseable / malformed rows (the
 * entity's `InvalidTaskId` is folded in — an invalid stored id IS corruption).
 */
export const TaskMapper = {
  toRow(task: TaskEntity): NewTaskRow {
    const meta = task.metadata as Record<string, unknown>;
    let runtime: string | null = null;
    let metaForJson: Record<string, unknown> = meta;
    if (typeof meta.runtime === "string") {
      runtime = meta.runtime;
      const { runtime: _runtime, ...rest } = meta;
      metaForJson = rest;
    }
    return {
      id: task.id,
      agent: task.agent,
      runtime,
      status: task.status,
      brief: task.brief,
      details: task.details ?? null,
      origin: task.origin,
      originId: task.originId ?? null,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      endedAt: task.endedAt ?? null,
      success: task.success !== undefined ? JSON.stringify(task.success) : null,
      failure: task.failure !== undefined ? JSON.stringify(task.failure) : null,
      cancellation: task.cancellation !== undefined ? JSON.stringify(task.cancellation) : null,
      metadata: JSON.stringify(metaForJson),
    };
  },

  toEntity(row: TaskRow): Result<TaskEntity, CorruptedTask> {
    const metadataResult = parseJsonObject(row.id, "metadata", row.metadata);
    if (metadataResult.isErr()) return err(metadataResult.error);
    let metadata = metadataResult.value;
    if (row.runtime !== null) metadata = { ...metadata, runtime: row.runtime };

    const success = parseJsonColumn<TaskSuccess>(row.id, "success", row.success);
    if (success.isErr()) return err(success.error);
    const failure = parseJsonColumn<TaskFailure>(row.id, "failure", row.failure);
    if (failure.isErr()) return err(failure.error);
    const cancellation = parseJsonColumn<TaskCancellation>(
      row.id,
      "cancellation",
      row.cancellation,
    );
    if (cancellation.isErr()) return err(cancellation.error);

    return TaskEntity.rehydrate({
      id: row.id,
      agent: row.agent,
      brief: row.brief,
      ...(row.details !== null ? { details: row.details } : {}),
      origin: row.origin as TaskOrigin,
      ...(row.originId !== null ? { originId: row.originId } : {}),
      status: row.status as TaskStatus,
      metadata,
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      ...(row.endedAt !== null ? { endedAt: row.endedAt } : {}),
      ...(success.value !== undefined ? { success: success.value } : {}),
      ...(failure.value !== undefined ? { failure: failure.value } : {}),
      ...(cancellation.value !== undefined ? { cancellation: cancellation.value } : {}),
    }).mapErr(
      (e): CorruptedTask =>
        e.type === "CorruptedTask"
          ? e
          : {
              type: "CorruptedTask",
              id: row.id,
              reason: `invalid stored task id: ${JSON.stringify(row.id)}`,
            },
    );
  },
} as const;

function parseJsonObject(
  id: string,
  name: string,
  raw: string,
): Result<Record<string, unknown>, CorruptedTask> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return err({
      type: "CorruptedTask",
      id,
      reason: `task.${name} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return err({ type: "CorruptedTask", id, reason: `task.${name} must decode to an object` });
  }
  return ok(parsed as Record<string, unknown>);
}

function parseJsonColumn<T>(
  id: string,
  name: string,
  raw: string | null,
): Result<T | undefined, CorruptedTask> {
  if (raw === null) return ok(undefined);
  return parseJsonObject(id, name, raw).map((o) => o as T);
}
