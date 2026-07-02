import { and, eq } from "drizzle-orm";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import pino, { type Logger } from "pino";
import type { WorkflowNodeEntity } from "../../domain/node/workflow-node-entity.js";
import type { WorkflowEntityCorruption } from "../../domain/workflow/workflow-corruption.js";
import type {
  WorkflowEntity,
  WorkflowHeaderSnapshot,
  WorkflowNodeSnapshot,
} from "../../domain/workflow/workflow-entity.js";
import type { WorkflowId } from "../../domain/workflow/workflow-id.js";
import type {
  DatabaseUnavailable,
  WorkflowNotFound,
  WorkflowRepository,
} from "../../domain/workflow/workflow-repository.js";
import type { Db } from "./workflow-db.js";
import { WorkflowMapper } from "./workflow-mapper.js";
import type { NewWorkflowNodeRow, NewWorkflowRow, WorkflowNodeRow } from "./workflow-schema.js";
import { workflowEdges, workflowNodes, workflows } from "./workflow-schema.js";

const silentLogger: Logger = pino({ level: "silent" });

type EdgeKeyParts = { readonly from: string; readonly to: string };

export class DrizzleWorkflowRepository implements WorkflowRepository {
  private readonly db: Db;
  private readonly logger: Logger;
  constructor(opts: { db: Db; logger?: Logger }) {
    this.db = opts.db;
    this.logger = opts.logger ?? silentLogger;
  }

  insert(entity: WorkflowEntity): ResultAsync<void, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      Promise.resolve().then(() =>
        this.db.transaction((tx) => {
          tx.insert(workflows).values(WorkflowMapper.toWorkflowRow(entity)).run();
          for (const node of entity.nodes)
            tx.insert(workflowNodes).values(WorkflowMapper.toNodeRow(node)).run();
          for (const edge of entity.edges)
            tx.insert(workflowEdges).values(WorkflowMapper.toEdgeRow(edge)).run();
        }),
      ),
      mapToDatabaseUnavailable,
    );
  }

  get(
    id: WorkflowId,
  ): ResultAsync<
    WorkflowEntity,
    WorkflowNotFound | WorkflowEntityCorruption | DatabaseUnavailable
  > {
    return ResultAsync.fromPromise(
      Promise.resolve().then(() => {
        const workflowRow = this.db.select().from(workflows).where(eq(workflows.id, id)).get();
        if (workflowRow === undefined) return { kind: "missing" as const };
        const nodeRows = this.db
          .select()
          .from(workflowNodes)
          .where(eq(workflowNodes.workflowId, id))
          .all();
        const edgeRows = this.db
          .select()
          .from(workflowEdges)
          .where(eq(workflowEdges.workflowId, id))
          .all();
        const entity = WorkflowMapper.toEntity({ workflowRow, nodeRows, edgeRows });
        if (entity.isErr()) {
          this.logger.warn(
            { workflowId: id, reason: entity.error.type },
            "workflows: corrupted workflow aggregate row",
          );
          return { kind: "corrupt" as const, error: entity.error };
        }
        return { kind: "ok" as const, entity: entity.value };
      }),
      mapToDatabaseUnavailable,
    ).andThen((result) => {
      if (result.kind === "missing")
        return errAsync({ type: "WorkflowNotFound" as const, workflowId: id });
      if (result.kind === "corrupt") return errAsync(result.error);
      return okAsync(result.entity);
    });
  }

  save(entity: WorkflowEntity): ResultAsync<void, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      Promise.resolve().then(() =>
        this.db.transaction((tx) => {
          if (entity.__isDeleted()) {
            tx.delete(workflowEdges).where(eq(workflowEdges.workflowId, entity.id)).run();
            tx.delete(workflowNodes).where(eq(workflowNodes.workflowId, entity.id)).run();
            tx.delete(workflows).where(eq(workflows.id, entity.id)).run();
            return;
          }
          const snapshot = entity.__snapshot();
          if (headerChanged(snapshot.header, entity))
            tx.update(workflows)
              .set(workflowPatch(entity))
              .where(eq(workflows.id, entity.id))
              .run();
          const currentNodes = new Map(entity.nodes.map((node) => [node.id, node]));
          for (const node of entity.nodes)
            if (!snapshot.nodes.has(node.id))
              tx.insert(workflowNodes).values(WorkflowMapper.toNodeRow(node)).run();
          for (const id of snapshot.nodes.keys())
            if (!currentNodes.has(id))
              tx.delete(workflowNodes).where(eq(workflowNodes.id, id)).run();
          for (const [id, snap] of snapshot.nodes) {
            const node = currentNodes.get(id);
            if (node !== undefined && nodeChanged(snap, node))
              tx.update(workflowNodes).set(nodePatch(node)).where(eq(workflowNodes.id, id)).run();
          }
          const currentEdgeKeys = new Set(entity.edges.map((edge) => edgeKey(edge.from, edge.to)));
          for (const key of snapshot.edgeKeys)
            if (!currentEdgeKeys.has(key)) {
              const edge = splitEdgeKey(key);
              tx.delete(workflowEdges)
                .where(
                  and(
                    eq(workflowEdges.workflowId, entity.id),
                    eq(workflowEdges.fromNodeId, edge.from),
                    eq(workflowEdges.toNodeId, edge.to),
                  ),
                )
                .run();
            }
          for (const edge of entity.edges)
            if (!snapshot.edgeKeys.has(edgeKey(edge.from, edge.to)))
              tx.insert(workflowEdges).values(WorkflowMapper.toEdgeRow(edge)).run();
        }),
      ),
      mapToDatabaseUnavailable,
    );
  }
}

function workflowPatch(entity: WorkflowEntity): NewWorkflowRow {
  return WorkflowMapper.toWorkflowRow(entity);
}
function nodePatch(node: WorkflowNodeEntity): Partial<WorkflowNodeRow> {
  const row = WorkflowMapper.toNodeRow(node);
  return {
    kind: row.kind,
    specJson: row.specJson,
    phase: row.phase,
    status: row.status,
    metadata: JSON.stringify(node.metadata),
    createdAt: row.createdAt,
    readyAt: row.readyAt ?? null,
    runningAt: row.runningAt ?? null,
    endedAt: row.endedAt ?? null,
  };
}
function headerChanged(snapshot: WorkflowHeaderSnapshot | null, entity: WorkflowEntity): boolean {
  if (snapshot === null) return true;
  const row = WorkflowMapper.toWorkflowRow(entity);
  const snapRow: NewWorkflowRow = {
    id: entity.id,
    brief: snapshot.brief,
    details: snapshot.details ?? null,
    coordinatorAgent: snapshot.coordinatorAgent,
    status: snapshot.status,
    origin: snapshot.origin,
    originId: snapshot.originId ?? null,
    metadata: JSON.stringify(snapshot.metadata),
    createdAt: snapshot.createdAt,
    startedAt: snapshot.startedAt ?? null,
    endedAt: snapshot.endedAt ?? null,
    success: snapshot.success === undefined ? null : JSON.stringify(snapshot.success),
    failure: snapshot.failure === undefined ? null : JSON.stringify(snapshot.failure),
    cancellation:
      snapshot.cancellation === undefined ? null : JSON.stringify(snapshot.cancellation),
  };
  return JSON.stringify(row) !== JSON.stringify(snapRow);
}
function nodeChanged(snapshot: WorkflowNodeSnapshot, node: WorkflowNodeEntity): boolean {
  const row = WorkflowMapper.toNodeRow(node);
  const snapRow: Partial<NewWorkflowNodeRow> = {
    specJson: JSON.stringify(snapshot.spec),
    phase: snapshot.phase,
    status: snapshot.status,
    metadata: JSON.stringify(snapshot.metadata),
    readyAt: snapshot.readyAt ?? null,
    runningAt: snapshot.runningAt ?? null,
    endedAt: snapshot.endedAt ?? null,
  };
  return (
    row.specJson !== snapRow.specJson ||
    row.phase !== snapRow.phase ||
    row.status !== snapRow.status ||
    row.metadata !== snapRow.metadata ||
    row.readyAt !== snapRow.readyAt ||
    row.runningAt !== snapRow.runningAt ||
    row.endedAt !== snapRow.endedAt
  );
}
function edgeKey(from: string, to: string): string {
  return `${from}->${to}`;
}
function splitEdgeKey(key: string): EdgeKeyParts {
  const index = key.indexOf("->");
  return { from: key.slice(0, index), to: key.slice(index + 2) };
}
function mapToDatabaseUnavailable(cause: unknown): DatabaseUnavailable {
  return { type: "DatabaseUnavailable", cause };
}
