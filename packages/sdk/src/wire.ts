/**
 * Named wire-DTO surface of `@glyphs-ai/sdk`.
 *
 * The committed `./generated/**` output is operation-shaped: every type
 * is a `<Method><Path>{Data,Responses,Errors}` envelope, because the
 * server's OpenAPI document inlines its schemas rather than registering
 * named components. Surfaces (`dashboard`, `cli`) still need the *named*
 * wire shapes (`AgentEntry`, `WorkflowHeader`, `CreateWorkflowRequest`,
 * …) to type props, request builders, and view models.
 *
 * This module reconstructs those names from the generated operation
 * envelopes alone, so the SDK stays 100% self-contained — it references
 * no `@glyphs-ai/*` package (value OR type), keeping the published
 * package safe to drop into the browser bundle (enforced by
 * `packages/e2e/test/architecture/sdk-no-server-runtime-import.test.ts`).
 *
 * Two derivation strategies:
 *
 *   - Response / domain shapes are sliced out of the generated success
 *     payloads via indexed-access types. The server's OpenAPI projection
 *     is interface-for-interface equal to the source domain types (guarded
 *     by `packages/api/test/wire-schema-parity.test.ts`), so a slice such
 *     as `GetApiWorkspacesByIdWorkflowsResponse[number]` is structurally
 *     the `WorkflowHeader` the surfaces expect.
 *   - Request bodies are hand-authored: the hand-validated routes carry
 *     no request schema in the OpenAPI document (their generated `Data`
 *     types expose `body?: never`), so there is nothing to slice. Each
 *     shape below mirrors its server-side validator 1:1.
 */

import type {
  GetApiWorkspacesByIdCatalogAgentsResponse,
  GetApiWorkspacesByIdCatalogMcpsResponse,
  GetApiWorkspacesByIdCatalogSkillsResponse,
  GetApiWorkspacesByIdSchedulesPreviewCronResponse,
  GetApiWorkspacesByIdSchedulesResponse,
  GetApiWorkspacesByIdWorkflowsByWfidArtifactsResponse,
  GetApiWorkspacesByIdWorkflowsByWfidDagResponse,
  GetApiWorkspacesByIdWorkflowsData,
  GetApiWorkspacesByIdWorkflowsResponse,
  PostApiWorkspacesByIdCatalogAgentsResponse,
} from "./generated/types.gen.js";

// ─── Catalog domain shapes (sliced from list / install payloads) ─────

/** Discriminator over the three catalog entry kinds. */
export type CatalogKind = PostApiWorkspacesByIdCatalogAgentsResponse["installed"][number]["kind"];

/** One installed-skill list entry (the skill record plus its block status). */
export type SkillEntry = GetApiWorkspacesByIdCatalogSkillsResponse[number];

/** The skill record carried by a {@link SkillEntry}. */
export type Skill = SkillEntry["skill"];

/** One installed-agent list entry (the agent record plus its block status). */
export type AgentEntry = GetApiWorkspacesByIdCatalogAgentsResponse[number];

/** The agent record carried by an {@link AgentEntry}. */
export type Agent = AgentEntry["agent"];

/** One installed-MCP list entry. */
export type Mcp = GetApiWorkspacesByIdCatalogMcpsResponse[number];

/** Why a catalog entry is in `blocked` status (absent when `ready`). */
export type BlockedReason = NonNullable<SkillEntry["blockedReason"]>;

/** A dependency the catalog could not resolve for an entry. */
export type MissingDep = NonNullable<SkillEntry["missingDeps"]>[number];

// ─── Catalog request bodies (hand-validated routes → no OpenAPI body) ─

/** POST `/catalog/agents` body — install an agent by origin URI. */
export interface InstallAgentRequest {
  readonly origin: string;
}

/** POST `/catalog/skills` body — install a skill by origin URI. */
export interface InstallSkillRequest {
  readonly origin: string;
}

// ─── Workflow domain shapes (sliced from list / DAG / artifacts) ─────

/** Wire projection of a workflow header row. */
export type WorkflowHeader = GetApiWorkspacesByIdWorkflowsResponse[number];

/** Full DAG snapshot (header + nodes + edges) for one workflow. */
export type WorkflowDag = GetApiWorkspacesByIdWorkflowsByWfidDagResponse;

/** Wire projection of a single workflow node. */
export type WorkflowNode = WorkflowDag["nodes"][number];

/** Wire projection of one DAG edge (parent → child node ids). */
export type WorkflowEdge = WorkflowDag["edges"][number];

/** Per-kind node spec, projected flat for the shipped kinds. */
export type WorkflowNodeSpec = WorkflowNode["spec"];

/** The `human`-kind arm of {@link WorkflowNodeSpec}. */
export type WorkflowHumanNodeSpec = Extract<WorkflowNodeSpec, { kind: "human" }>;

/** Response shape for the workflow artifacts listing. */
export type WorkflowArtifactsResponse = GetApiWorkspacesByIdWorkflowsByWfidArtifactsResponse;

/** Wire projection of a single workflow artifact. */
export type WorkflowArtifact = WorkflowArtifactsResponse["artifacts"][number];

/** Query string for the workflow list endpoint. */
export type WorkflowListQuery = NonNullable<GetApiWorkspacesByIdWorkflowsData["query"]>;

// ─── Workflow request bodies (hand-validated routes → no OpenAPI body) ─

/** POST `/workflows` body — create a workflow. */
export interface CreateWorkflowRequest {
  readonly brief: string;
  readonly details?: string;
  readonly coordinatorAgent: string;
}

/** POST `/workflows/:wfid/cancel` body. */
export interface CancelWorkflowRequest {
  readonly cancellation: {
    readonly kind: "user";
    readonly message: string;
  };
}

/** POST `/workflows/:wfid/nodes/:nid/respond` body — answer a human node. */
export interface RespondHumanNodeRequest {
  readonly choiceId?: string;
  readonly input?: string;
}

// ─── Schedule domain shapes (sliced from list / preview payloads) ────

/** Wire projection of a schedule header row (flat target). */
export type Schedule = GetApiWorkspacesByIdSchedulesResponse[number];

/** Flat wire target on a schedule response. */
export type ScheduleTarget = Schedule["target"];

/** The `task`-kind arm of {@link ScheduleTarget}. */
export type TaskScheduleTarget = Extract<ScheduleTarget, { kind: "task" }>;

/** The `workflow`-kind arm of {@link ScheduleTarget}. */
export type WorkflowScheduleTarget = Extract<ScheduleTarget, { kind: "workflow" }>;

/** Cron preview result — human description plus the next fire timestamps. */
export type PreviewScheduleResult = GetApiWorkspacesByIdSchedulesPreviewCronResponse;

// ─── Schedule request bodies (hand-validated routes → no OpenAPI body) ─

/** Task-kind target data payload (create body, URL-implied `kind`). */
export interface TaskTargetData {
  readonly agent: string;
  readonly brief: string;
  readonly details?: string;
  readonly runtime?: string;
}

/** RFC 7396 deep-merge patch for a task target (`null` deletes optionals). */
export interface TaskTargetPatch {
  readonly agent?: string;
  readonly brief?: string;
  readonly details?: string | null;
  readonly runtime?: string | null;
}

/** Workflow-kind target data payload (create body, URL-implied `kind`). */
export interface WorkflowTargetData {
  readonly coordinatorAgent: string;
  readonly brief: string;
  readonly details?: string;
}

/** RFC 7396 deep-merge patch for a workflow target (`null` deletes optionals). */
export interface WorkflowTargetPatch {
  readonly coordinatorAgent?: string;
  readonly brief?: string;
  readonly details?: string | null;
}

/** Shared cron trigger shape carried by the schedule create bodies. */
export interface ScheduleCronTrigger {
  readonly kind: "cron";
  readonly expr: string;
  readonly tz: string;
}

/** POST `/schedules/task` body. */
export interface CreateTaskScheduleRequest {
  readonly name: string;
  readonly target: TaskTargetData;
  readonly trigger: ScheduleCronTrigger;
  readonly enabled?: boolean;
}

/** PATCH `/schedules/task/:sid` body. */
export interface PatchTaskScheduleRequest {
  readonly name?: string;
  readonly target?: TaskTargetPatch;
  readonly trigger?: ScheduleCronTrigger;
  readonly enabled?: boolean;
}

/** POST `/schedules/workflow` body. */
export interface CreateWorkflowScheduleRequest {
  readonly name: string;
  readonly target: WorkflowTargetData;
  readonly trigger: ScheduleCronTrigger;
  readonly enabled?: boolean;
}

/** PATCH `/schedules/workflow/:sid` body. */
export interface PatchWorkflowScheduleRequest {
  readonly name?: string;
  readonly target?: WorkflowTargetPatch;
  readonly trigger?: ScheduleCronTrigger;
  readonly enabled?: boolean;
}
