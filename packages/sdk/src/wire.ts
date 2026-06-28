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
 *     is structurally equal to the source domain types, so a slice such
 *     as `GetApiWorkspacesByIdWorkflowsResponse[number]` is structurally
 *     the `WorkflowHeader` the surfaces expect.
 *   - Request bodies are sliced from the generated operation `Data`
 *     types via `Data["body"]` indexed-access. The routes now declare
 *     their request schemas in the OpenAPI document, so every mutation
 *     operation carries a typed `body`. Named aliases here keep the
 *     surface-layer type names stable.
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
  PatchApiWorkspacesByIdSchedulesTaskBySidData,
  PatchApiWorkspacesByIdSchedulesWorkflowBySidData,
  PatchApiWorkspacesByIdWorkflowsByWfidNodesByNidSpecData,
  PostApiWorkspacesByIdCatalogAgentsData,
  PostApiWorkspacesByIdCatalogAgentsResponse,
  PostApiWorkspacesByIdCatalogSkillsData,
  PostApiWorkspacesByIdSchedulesTaskData,
  PostApiWorkspacesByIdSchedulesWorkflowData,
  PostApiWorkspacesByIdWorkflowsByWfidCancelData,
  PostApiWorkspacesByIdWorkflowsByWfidEdgesData,
  PostApiWorkspacesByIdWorkflowsByWfidFinishData,
  PostApiWorkspacesByIdWorkflowsByWfidNodesByNidRespondData,
  PostApiWorkspacesByIdWorkflowsByWfidNodesData,
  PostApiWorkspacesByIdWorkflowsByWfidSubgraphData,
  PostApiWorkspacesByIdWorkflowsData as PostWorkflowsData,
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

// ─── Catalog request bodies (sliced from generated operation bodies) ──

/** POST `/catalog/agents` body — install an agent by origin URI. */
export type InstallAgentRequest = NonNullable<PostApiWorkspacesByIdCatalogAgentsData["body"]>;

/** POST `/catalog/skills` body — install a skill by origin URI. */
export type InstallSkillRequest = NonNullable<PostApiWorkspacesByIdCatalogSkillsData["body"]>;

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

/** Discriminator over the workflow node kinds the substrate ships. */
export type WorkflowNodeKind = "coordinator" | "worker" | "human";

/** Response shape for the workflow artifacts listing. */
export type WorkflowArtifactsResponse = GetApiWorkspacesByIdWorkflowsByWfidArtifactsResponse;

/** Wire projection of a single workflow artifact. */
export type WorkflowArtifact = WorkflowArtifactsResponse["artifacts"][number];

/** Query string for the workflow list endpoint. */
export type WorkflowListQuery = NonNullable<GetApiWorkspacesByIdWorkflowsData["query"]>;

// ─── Workflow request bodies (sliced from generated operation bodies) ──

/** POST `/workflows` body — create a workflow. */
export type CreateWorkflowRequest = NonNullable<PostWorkflowsData["body"]>;

/** POST `/workflows/:wfid/cancel` body. */
export type CancelWorkflowRequest = NonNullable<
  PostApiWorkspacesByIdWorkflowsByWfidCancelData["body"]
>;

/** POST `/workflows/:wfid/nodes/:nid/respond` body — answer a human node. */
export type RespondHumanNodeRequest = NonNullable<
  PostApiWorkspacesByIdWorkflowsByWfidNodesByNidRespondData["body"]
>;

// ─── Workflow mutation bodies (sliced from generated operation bodies) ──

/** POST `/workflows/:wfid/nodes` body — insert one node under `parents`. */
export type AddNodeRequest = NonNullable<PostApiWorkspacesByIdWorkflowsByWfidNodesData["body"]>;

/** POST `/workflows/:wfid/edges` body — link `fromNodeId` → `toNodeId`. */
export type AddEdgeRequest = NonNullable<PostApiWorkspacesByIdWorkflowsByWfidEdgesData["body"]>;

/** POST `/workflows/:wfid/subgraph` body — insert a batch of nodes + edges. */
export type AddSubgraphRequest = NonNullable<
  PostApiWorkspacesByIdWorkflowsByWfidSubgraphData["body"]
>;

/** One declared temp node in an `addSubgraph` batch. */
export type AddSubgraphRequestNode = AddSubgraphRequest["nodes"][number];

/** One declared edge in an `addSubgraph` batch. */
export type AddSubgraphRequestEdge = AddSubgraphRequest["edges"][number];

/**
 * Reference to a node in an `addSubgraph` batch — either an existing
 * node (`nodeId`) or a temp node declared in the same batch (`tempId`).
 */
export type WorkflowNodeRef = AddSubgraphRequestEdge["from"];

/** PATCH `/workflows/:wfid/nodes/:nid/spec` body — re-validate + replace spec. */
export type ReplaceNodeSpecRequest = NonNullable<
  PatchApiWorkspacesByIdWorkflowsByWfidNodesByNidSpecData["body"]
>;

/** POST `/workflows/:wfid/finish` body — flip the workflow terminal. */
export type FinishWorkflowRequest = NonNullable<
  PostApiWorkspacesByIdWorkflowsByWfidFinishData["body"]
>;

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

// ─── Schedule request bodies (sliced from generated operation bodies) ──

/** POST `/schedules/task` body. */
export type CreateTaskScheduleRequest = NonNullable<PostApiWorkspacesByIdSchedulesTaskData["body"]>;

/** PATCH `/schedules/task/:sid` body. */
export type PatchTaskScheduleRequest = NonNullable<
  PatchApiWorkspacesByIdSchedulesTaskBySidData["body"]
>;

/** POST `/schedules/workflow` body. */
export type CreateWorkflowScheduleRequest = NonNullable<
  PostApiWorkspacesByIdSchedulesWorkflowData["body"]
>;

/** PATCH `/schedules/workflow/:sid` body. */
export type PatchWorkflowScheduleRequest = NonNullable<
  PatchApiWorkspacesByIdSchedulesWorkflowBySidData["body"]
>;

/** Task-kind target data payload (create body, URL-implied `kind`). */
export type TaskTargetData = CreateTaskScheduleRequest["target"];

/** RFC 7396 deep-merge patch for a task target (`null` deletes optionals). */
export type TaskTargetPatch = NonNullable<PatchTaskScheduleRequest["target"]>;

/** Workflow-kind target data payload (create body, URL-implied `kind`). */
export type WorkflowTargetData = CreateWorkflowScheduleRequest["target"];

/** RFC 7396 deep-merge patch for a workflow target (`null` deletes optionals). */
export type WorkflowTargetPatch = NonNullable<PatchWorkflowScheduleRequest["target"]>;

/** Shared cron trigger shape carried by the schedule create bodies. */
export type ScheduleCronTrigger = CreateTaskScheduleRequest["trigger"];
