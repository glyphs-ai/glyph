/**
 * Wire-schema parity guard.
 *
 * For every wire DTO exported from `@glyphs-ai/contracts`, asserts that
 * the corresponding zod schema in `@glyphs-ai/api`'s `schemas/` infers a
 * type that is mutually assignable with the hand-written interface — i.e.
 * `z.infer<typeof XSchema>` is assignable to `X` AND vice-versa.
 *
 * These are compile-time assertions (no-ops at runtime): the package's
 * `tsconfig.typecheck.json` includes `test/**`, so `pnpm typecheck`
 * fails the build the instant a schema drifts from its interface. The
 * `it` wrapper keeps the file a valid (trivially-passing) Vitest spec so
 * `pnpm test` lists it too.
 *
 * Readonly modifiers are intentionally NOT required to match: zod infers
 * mutable object types while the contracts interfaces are deeply
 * `readonly`. The two are mutually assignable, which is all the wire
 * cares about — `toExtend` (assignability), not `toEqualTypeOf` (strict
 * structural identity), is the right matcher here.
 *
 * Likewise, optional fields are compared modulo their `undefined`
 * encoding. zod's `.optional()` infers `key?: T | undefined`, whereas the
 * contracts (compiled with `exactOptionalPropertyTypes`) declare
 * `key?: T` — the key is absent, never explicitly `undefined`. Both
 * describe the same JSON (the key is simply omitted), so {@link Wire}
 * strips `undefined` from every property value before comparison while
 * preserving each property's optional modifier (and recursing through
 * arrays / nested objects / unions). A genuinely missing or
 * wrongly-typed field still fails parity — only the zod-vs-EOPT optional
 * encoding is neutralised.
 */

import type {
  ActivityItem,
  AddEdgeRequest,
  AddEdgeResponse,
  AddNodeRequest,
  AddNodeResponse,
  AddSubgraphRequest,
  AddSubgraphRequestEdge,
  AddSubgraphRequestNode,
  AddSubgraphResponse,
  AddSubgraphResponseInsertedNode,
  Agent,
  AgentEntry,
  AgentManifestNode,
  AgentWithContent,
  AnchorResponse,
  BlockedReason,
  CancelWorkflowRequest,
  CatalogConflict,
  CatalogFileEntry,
  CatalogInstallResult,
  CatalogKind,
  CatalogOverview,
  CatalogResourcePathParams,
  CatalogSyncResult,
  CreateSessionRequest,
  CreateTaskScheduleRequest,
  CreateWorkflowRequest,
  CreateWorkflowScheduleRequest,
  CreateWorkspaceRequest,
  CurrentWorkspaceResponse,
  DispatchTaskRequest,
  FinishWorkflowRequest,
  HealthResponse,
  InstallAgentRequest,
  InstallSkillRequest,
  Mcp,
  McpManifestNode,
  McpWithContent,
  MissingDep,
  OkResponse,
  OrphanManifestEntry,
  PatchTaskScheduleRequest,
  PatchWorkflowScheduleRequest,
  PatchWorkspaceRequest,
  PreviewScheduleResult,
  ReplaceNodeSpecRequest,
  ResolveManifest,
  ResolveManifestNode,
  RespondHumanNodeRequest,
  RuntimeInfo,
  Schedule,
  ScheduleDeleteResponse,
  ScheduledTaskListQuery,
  ScheduleGetResponse,
  ScheduleHeader,
  ScheduleListQuery,
  SchedulePathParams,
  SchedulePreviewCronQuery,
  SchedulePreviewQuery,
  ScheduleRunResponse,
  ScheduleTarget,
  ServerConfig,
  Session,
  SessionDeleteQuery,
  SessionListQuery,
  SessionPathParams,
  SetCurrentWorkspaceRequest,
  Skill,
  SkillEntry,
  SkillManifestNode,
  SkillWithContent,
  SpawnSessionRequest,
  SpawnSessionResponse,
  SyncCatalogRequest,
  Task,
  TaskActivityQuery,
  TaskDeleteQuery,
  TaskListQuery,
  TaskPathParams,
  TaskScheduleTarget,
  TaskTargetData,
  TaskTargetPatch,
  TruncationInfo,
  WorkflowArtifact,
  WorkflowArtifactMimeBucket,
  WorkflowArtifactPathParams,
  WorkflowArtifactsResponse,
  WorkflowCancellation,
  WorkflowCoordinatorNodeSpec,
  WorkflowDag,
  WorkflowDeleteQuery,
  WorkflowEdge,
  WorkflowEdgePathParams,
  WorkflowFailure,
  WorkflowHeader,
  WorkflowHumanNodeSpec,
  WorkflowListQuery,
  WorkflowNode,
  WorkflowNodeKind,
  WorkflowNodePathParams,
  WorkflowNodeRef,
  WorkflowNodeSpec,
  WorkflowNodeStatus,
  WorkflowOrigin,
  WorkflowPathParams,
  WorkflowScheduleTarget,
  WorkflowStatus,
  WorkflowSuccess,
  WorkflowTargetData,
  WorkflowTargetPatch,
  WorkflowWorkerNodeSpec,
  WorkspaceLoadFailedResponse,
  WorkspacePathParams,
  WorkspaceSummary,
  WorkspaceWarmingResponse,
} from "@glyphs-ai/contracts";
import { describe, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import type {
  ActivityItemSchema,
  AddEdgeRequestSchema,
  AddEdgeResponseSchema,
  AddNodeRequestSchema,
  AddNodeResponseSchema,
  AddSubgraphRequestEdgeSchema,
  AddSubgraphRequestNodeSchema,
  AddSubgraphRequestSchema,
  AddSubgraphResponseInsertedNodeSchema,
  AddSubgraphResponseSchema,
  AgentEntrySchema,
  AgentManifestNodeSchema,
  AgentSchema,
  AgentWithContentSchema,
  AnchorResponseSchema,
  BlockedReasonSchema,
  CancelWorkflowRequestSchema,
  CatalogConflictSchema,
  CatalogFileEntrySchema,
  CatalogInstallResultSchema,
  CatalogKindSchema,
  CatalogOverviewSchema,
  CatalogResourcePathParamsSchema,
  CatalogSyncResultSchema,
  CreateSessionRequestSchema,
  CreateTaskScheduleRequestSchema,
  CreateWorkflowRequestSchema,
  CreateWorkflowScheduleRequestSchema,
  CreateWorkspaceRequestSchema,
  CurrentWorkspaceResponseSchema,
  DispatchTaskRequestSchema,
  FinishWorkflowRequestSchema,
  HealthResponseSchema,
  InstallAgentRequestSchema,
  InstallSkillRequestSchema,
  McpManifestNodeSchema,
  McpSchema,
  McpWithContentSchema,
  MissingDepSchema,
  OkResponseSchema,
  OrphanManifestEntrySchema,
  PatchTaskScheduleRequestSchema,
  PatchWorkflowScheduleRequestSchema,
  PatchWorkspaceRequestSchema,
  PreviewScheduleResultSchema,
  ReplaceNodeSpecRequestSchema,
  ResolveManifestNodeSchema,
  ResolveManifestSchema,
  RespondHumanNodeRequestSchema,
  RuntimeInfoSchema,
  ScheduleDeleteResponseSchema,
  ScheduledTaskListQuerySchema,
  ScheduleGetResponseSchema,
  ScheduleHeaderSchema,
  ScheduleListQuerySchema,
  SchedulePathParamsSchema,
  SchedulePreviewCronQuerySchema,
  SchedulePreviewQuerySchema,
  ScheduleRunResponseSchema,
  ScheduleSchema,
  ScheduleTargetSchema,
  ServerConfigSchema,
  SessionDeleteQuerySchema,
  SessionListQuerySchema,
  SessionPathParamsSchema,
  SessionSchema,
  SetCurrentWorkspaceRequestSchema,
  SkillEntrySchema,
  SkillManifestNodeSchema,
  SkillSchema,
  SkillWithContentSchema,
  SpawnSessionRequestSchema,
  SpawnSessionResponseSchema,
  SyncCatalogRequestSchema,
  TaskActivityQuerySchema,
  TaskActivityResponseSchema,
  TaskDeleteQuerySchema,
  TaskListQuerySchema,
  TaskPathParamsSchema,
  TaskScheduleTargetSchema,
  TaskSchema,
  TaskTargetDataSchema,
  TaskTargetPatchSchema,
  TruncationInfoSchema,
  WorkflowArtifactMimeBucketSchema,
  WorkflowArtifactPathParamsSchema,
  WorkflowArtifactSchema,
  WorkflowArtifactsResponseSchema,
  WorkflowCancellationSchema,
  WorkflowCoordinatorNodeSpecSchema,
  WorkflowDagSchema,
  WorkflowDeleteQuerySchema,
  WorkflowEdgePathParamsSchema,
  WorkflowEdgeSchema,
  WorkflowFailureSchema,
  WorkflowHeaderSchema,
  WorkflowHumanNodeSpecSchema,
  WorkflowListQuerySchema,
  WorkflowNodeKindSchema,
  WorkflowNodePathParamsSchema,
  WorkflowNodeRefSchema,
  WorkflowNodeSchema,
  WorkflowNodeSpecSchema,
  WorkflowNodeStatusSchema,
  WorkflowOriginSchema,
  WorkflowPathParamsSchema,
  WorkflowScheduleTargetSchema,
  WorkflowStatusSchema,
  WorkflowSuccessSchema,
  WorkflowTargetDataSchema,
  WorkflowTargetPatchSchema,
  WorkflowWorkerNodeSpecSchema,
  WorkspaceLoadFailedResponseSchema,
  WorkspacePathParamsSchema,
  WorkspaceSummarySchema,
  WorkspaceWarmingResponseSchema,
} from "../src/schemas/index.js";

/**
 * The `tasks.activity.list` response is an anonymous inline type on the
 * route manifest rather than a named `contracts` export; this mirror is
 * the parity target for {@link TaskActivityResponseSchema}.
 */
interface TaskActivityResponse {
  readonly activity: readonly ActivityItem[];
  readonly result: string | null;
  readonly totalItems: number;
  readonly truncated?: TruncationInfo;
}

/**
 * Normalise the zod-vs-`exactOptionalPropertyTypes` optional encoding:
 * strip `| undefined` from every property value (preserving the optional
 * modifier), recursing through arrays, nested objects, and distributing
 * over unions so discriminated unions keep their members.
 *
 * The outer `T extends unknown ? … : never` is a no-op that forces the
 * conditional to distribute over a union `T` member-by-member; without
 * it the homomorphic mapped type collapses a discriminated union into a
 * single object whose per-variant keys become `never`.
 */
type Wire<T> = T extends unknown ? WireNormalised<T> : never;
type WireNormalised<T> = T extends readonly (infer U)[]
  ? Wire<U>[]
  : T extends object
    ? { [K in keyof T]: Wire<Exclude<T[K], undefined>> }
    : T;

describe("wire-schema parity", () => {
  it("health / runtimes / server-config", () => {
    expectTypeOf<Wire<z.infer<typeof HealthResponseSchema>>>().toExtend<Wire<HealthResponse>>();
    expectTypeOf<Wire<HealthResponse>>().toExtend<Wire<z.infer<typeof HealthResponseSchema>>>();

    expectTypeOf<Wire<z.infer<typeof RuntimeInfoSchema>>>().toExtend<Wire<RuntimeInfo>>();
    expectTypeOf<Wire<RuntimeInfo>>().toExtend<Wire<z.infer<typeof RuntimeInfoSchema>>>();

    expectTypeOf<Wire<z.infer<typeof ServerConfigSchema>>>().toExtend<Wire<ServerConfig>>();
    expectTypeOf<Wire<ServerConfig>>().toExtend<Wire<z.infer<typeof ServerConfigSchema>>>();
  });

  it("workspaces", () => {
    expectTypeOf<Wire<z.infer<typeof WorkspaceSummarySchema>>>().toExtend<Wire<WorkspaceSummary>>();
    expectTypeOf<Wire<WorkspaceSummary>>().toExtend<Wire<z.infer<typeof WorkspaceSummarySchema>>>();

    expectTypeOf<Wire<z.infer<typeof CreateWorkspaceRequestSchema>>>().toExtend<
      Wire<CreateWorkspaceRequest>
    >();
    expectTypeOf<Wire<CreateWorkspaceRequest>>().toExtend<
      Wire<z.infer<typeof CreateWorkspaceRequestSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof SetCurrentWorkspaceRequestSchema>>>().toExtend<
      Wire<SetCurrentWorkspaceRequest>
    >();
    expectTypeOf<Wire<SetCurrentWorkspaceRequest>>().toExtend<
      Wire<z.infer<typeof SetCurrentWorkspaceRequestSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof PatchWorkspaceRequestSchema>>>().toExtend<
      Wire<PatchWorkspaceRequest>
    >();
    expectTypeOf<Wire<PatchWorkspaceRequest>>().toExtend<
      Wire<z.infer<typeof PatchWorkspaceRequestSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof CurrentWorkspaceResponseSchema>>>().toExtend<
      Wire<CurrentWorkspaceResponse>
    >();
    expectTypeOf<Wire<CurrentWorkspaceResponse>>().toExtend<
      Wire<z.infer<typeof CurrentWorkspaceResponseSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof WorkspaceWarmingResponseSchema>>>().toExtend<
      Wire<WorkspaceWarmingResponse>
    >();
    expectTypeOf<Wire<WorkspaceWarmingResponse>>().toExtend<
      Wire<z.infer<typeof WorkspaceWarmingResponseSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof WorkspaceLoadFailedResponseSchema>>>().toExtend<
      Wire<WorkspaceLoadFailedResponse>
    >();
    expectTypeOf<Wire<WorkspaceLoadFailedResponse>>().toExtend<
      Wire<z.infer<typeof WorkspaceLoadFailedResponseSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof WorkspacePathParamsSchema>>>().toExtend<
      Wire<WorkspacePathParams>
    >();
    expectTypeOf<Wire<WorkspacePathParams>>().toExtend<
      Wire<z.infer<typeof WorkspacePathParamsSchema>>
    >();
  });

  it("sessions", () => {
    expectTypeOf<Wire<z.infer<typeof SessionSchema>>>().toExtend<Wire<Session>>();
    expectTypeOf<Wire<Session>>().toExtend<Wire<z.infer<typeof SessionSchema>>>();

    expectTypeOf<Wire<z.infer<typeof SessionListQuerySchema>>>().toExtend<Wire<SessionListQuery>>();
    expectTypeOf<Wire<SessionListQuery>>().toExtend<Wire<z.infer<typeof SessionListQuerySchema>>>();

    expectTypeOf<Wire<z.infer<typeof CreateSessionRequestSchema>>>().toExtend<
      Wire<CreateSessionRequest>
    >();
    expectTypeOf<Wire<CreateSessionRequest>>().toExtend<
      Wire<z.infer<typeof CreateSessionRequestSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof SessionDeleteQuerySchema>>>().toExtend<
      Wire<SessionDeleteQuery>
    >();
    expectTypeOf<Wire<SessionDeleteQuery>>().toExtend<
      Wire<z.infer<typeof SessionDeleteQuerySchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof SpawnSessionRequestSchema>>>().toExtend<
      Wire<SpawnSessionRequest>
    >();
    expectTypeOf<Wire<SpawnSessionRequest>>().toExtend<
      Wire<z.infer<typeof SpawnSessionRequestSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof SpawnSessionResponseSchema>>>().toExtend<
      Wire<SpawnSessionResponse>
    >();
    expectTypeOf<Wire<SpawnSessionResponse>>().toExtend<
      Wire<z.infer<typeof SpawnSessionResponseSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof SessionPathParamsSchema>>>().toExtend<
      Wire<SessionPathParams>
    >();
    expectTypeOf<Wire<SessionPathParams>>().toExtend<
      Wire<z.infer<typeof SessionPathParamsSchema>>
    >();
  });

  it("tasks / scheduled-tasks", () => {
    expectTypeOf<Wire<z.infer<typeof TaskSchema>>>().toExtend<Wire<Task>>();
    expectTypeOf<Wire<Task>>().toExtend<Wire<z.infer<typeof TaskSchema>>>();

    expectTypeOf<Wire<z.infer<typeof ActivityItemSchema>>>().toExtend<Wire<ActivityItem>>();
    expectTypeOf<Wire<ActivityItem>>().toExtend<Wire<z.infer<typeof ActivityItemSchema>>>();

    expectTypeOf<Wire<z.infer<typeof TruncationInfoSchema>>>().toExtend<Wire<TruncationInfo>>();
    expectTypeOf<Wire<TruncationInfo>>().toExtend<Wire<z.infer<typeof TruncationInfoSchema>>>();

    expectTypeOf<Wire<z.infer<typeof TaskActivityResponseSchema>>>().toExtend<
      Wire<TaskActivityResponse>
    >();
    expectTypeOf<Wire<TaskActivityResponse>>().toExtend<
      Wire<z.infer<typeof TaskActivityResponseSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof TaskListQuerySchema>>>().toExtend<Wire<TaskListQuery>>();
    expectTypeOf<Wire<TaskListQuery>>().toExtend<Wire<z.infer<typeof TaskListQuerySchema>>>();

    expectTypeOf<Wire<z.infer<typeof ScheduledTaskListQuerySchema>>>().toExtend<
      Wire<ScheduledTaskListQuery>
    >();
    expectTypeOf<Wire<ScheduledTaskListQuery>>().toExtend<
      Wire<z.infer<typeof ScheduledTaskListQuerySchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof DispatchTaskRequestSchema>>>().toExtend<
      Wire<DispatchTaskRequest>
    >();
    expectTypeOf<Wire<DispatchTaskRequest>>().toExtend<
      Wire<z.infer<typeof DispatchTaskRequestSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof TaskDeleteQuerySchema>>>().toExtend<Wire<TaskDeleteQuery>>();
    expectTypeOf<Wire<TaskDeleteQuery>>().toExtend<Wire<z.infer<typeof TaskDeleteQuerySchema>>>();

    expectTypeOf<Wire<z.infer<typeof TaskActivityQuerySchema>>>().toExtend<
      Wire<TaskActivityQuery>
    >();
    expectTypeOf<Wire<TaskActivityQuery>>().toExtend<
      Wire<z.infer<typeof TaskActivityQuerySchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof TaskPathParamsSchema>>>().toExtend<Wire<TaskPathParams>>();
    expectTypeOf<Wire<TaskPathParams>>().toExtend<Wire<z.infer<typeof TaskPathParamsSchema>>>();
  });

  it("schedules / scheduled-workflows", () => {
    expectTypeOf<Wire<z.infer<typeof ScheduleSchema>>>().toExtend<Wire<Schedule>>();
    expectTypeOf<Wire<Schedule>>().toExtend<Wire<z.infer<typeof ScheduleSchema>>>();

    expectTypeOf<Wire<z.infer<typeof ScheduleTargetSchema>>>().toExtend<Wire<ScheduleTarget>>();
    expectTypeOf<Wire<ScheduleTarget>>().toExtend<Wire<z.infer<typeof ScheduleTargetSchema>>>();

    expectTypeOf<Wire<z.infer<typeof TaskTargetDataSchema>>>().toExtend<Wire<TaskTargetData>>();
    expectTypeOf<Wire<TaskTargetData>>().toExtend<Wire<z.infer<typeof TaskTargetDataSchema>>>();

    expectTypeOf<Wire<z.infer<typeof TaskTargetPatchSchema>>>().toExtend<Wire<TaskTargetPatch>>();
    expectTypeOf<Wire<TaskTargetPatch>>().toExtend<Wire<z.infer<typeof TaskTargetPatchSchema>>>();

    expectTypeOf<Wire<z.infer<typeof TaskScheduleTargetSchema>>>().toExtend<
      Wire<TaskScheduleTarget>
    >();
    expectTypeOf<Wire<TaskScheduleTarget>>().toExtend<
      Wire<z.infer<typeof TaskScheduleTargetSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof WorkflowTargetDataSchema>>>().toExtend<
      Wire<WorkflowTargetData>
    >();
    expectTypeOf<Wire<WorkflowTargetData>>().toExtend<
      Wire<z.infer<typeof WorkflowTargetDataSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof WorkflowTargetPatchSchema>>>().toExtend<
      Wire<WorkflowTargetPatch>
    >();
    expectTypeOf<Wire<WorkflowTargetPatch>>().toExtend<
      Wire<z.infer<typeof WorkflowTargetPatchSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof WorkflowScheduleTargetSchema>>>().toExtend<
      Wire<WorkflowScheduleTarget>
    >();
    expectTypeOf<Wire<WorkflowScheduleTarget>>().toExtend<
      Wire<z.infer<typeof WorkflowScheduleTargetSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof ScheduleHeaderSchema>>>().toExtend<Wire<ScheduleHeader>>();
    expectTypeOf<Wire<ScheduleHeader>>().toExtend<Wire<z.infer<typeof ScheduleHeaderSchema>>>();

    expectTypeOf<Wire<z.infer<typeof ScheduleGetResponseSchema>>>().toExtend<
      Wire<ScheduleGetResponse>
    >();
    expectTypeOf<Wire<ScheduleGetResponse>>().toExtend<
      Wire<z.infer<typeof ScheduleGetResponseSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof PreviewScheduleResultSchema>>>().toExtend<
      Wire<PreviewScheduleResult>
    >();
    expectTypeOf<Wire<PreviewScheduleResult>>().toExtend<
      Wire<z.infer<typeof PreviewScheduleResultSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof ScheduleDeleteResponseSchema>>>().toExtend<
      Wire<ScheduleDeleteResponse>
    >();
    expectTypeOf<Wire<ScheduleDeleteResponse>>().toExtend<
      Wire<z.infer<typeof ScheduleDeleteResponseSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof ScheduleRunResponseSchema>>>().toExtend<
      Wire<ScheduleRunResponse>
    >();
    expectTypeOf<Wire<ScheduleRunResponse>>().toExtend<
      Wire<z.infer<typeof ScheduleRunResponseSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof ScheduleListQuerySchema>>>().toExtend<
      Wire<ScheduleListQuery>
    >();
    expectTypeOf<Wire<ScheduleListQuery>>().toExtend<
      Wire<z.infer<typeof ScheduleListQuerySchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof SchedulePreviewQuerySchema>>>().toExtend<
      Wire<SchedulePreviewQuery>
    >();
    expectTypeOf<Wire<SchedulePreviewQuery>>().toExtend<
      Wire<z.infer<typeof SchedulePreviewQuerySchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof SchedulePreviewCronQuerySchema>>>().toExtend<
      Wire<SchedulePreviewCronQuery>
    >();
    expectTypeOf<Wire<SchedulePreviewCronQuery>>().toExtend<
      Wire<z.infer<typeof SchedulePreviewCronQuerySchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof SchedulePathParamsSchema>>>().toExtend<
      Wire<SchedulePathParams>
    >();
    expectTypeOf<Wire<SchedulePathParams>>().toExtend<
      Wire<z.infer<typeof SchedulePathParamsSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof CreateTaskScheduleRequestSchema>>>().toExtend<
      Wire<CreateTaskScheduleRequest>
    >();
    expectTypeOf<Wire<CreateTaskScheduleRequest>>().toExtend<
      Wire<z.infer<typeof CreateTaskScheduleRequestSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof PatchTaskScheduleRequestSchema>>>().toExtend<
      Wire<PatchTaskScheduleRequest>
    >();
    expectTypeOf<Wire<PatchTaskScheduleRequest>>().toExtend<
      Wire<z.infer<typeof PatchTaskScheduleRequestSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof CreateWorkflowScheduleRequestSchema>>>().toExtend<
      Wire<CreateWorkflowScheduleRequest>
    >();
    expectTypeOf<Wire<CreateWorkflowScheduleRequest>>().toExtend<
      Wire<z.infer<typeof CreateWorkflowScheduleRequestSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof PatchWorkflowScheduleRequestSchema>>>().toExtend<
      Wire<PatchWorkflowScheduleRequest>
    >();
    expectTypeOf<Wire<PatchWorkflowScheduleRequest>>().toExtend<
      Wire<z.infer<typeof PatchWorkflowScheduleRequestSchema>>
    >();
  });

  it("workflows / scheduled-workflows", () => {
    expectTypeOf<Wire<z.infer<typeof WorkflowStatusSchema>>>().toExtend<Wire<WorkflowStatus>>();
    expectTypeOf<Wire<WorkflowStatus>>().toExtend<Wire<z.infer<typeof WorkflowStatusSchema>>>();

    expectTypeOf<Wire<z.infer<typeof WorkflowOriginSchema>>>().toExtend<Wire<WorkflowOrigin>>();
    expectTypeOf<Wire<WorkflowOrigin>>().toExtend<Wire<z.infer<typeof WorkflowOriginSchema>>>();

    expectTypeOf<Wire<z.infer<typeof WorkflowNodeStatusSchema>>>().toExtend<
      Wire<WorkflowNodeStatus>
    >();
    expectTypeOf<Wire<WorkflowNodeStatus>>().toExtend<
      Wire<z.infer<typeof WorkflowNodeStatusSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof WorkflowNodeKindSchema>>>().toExtend<Wire<WorkflowNodeKind>>();
    expectTypeOf<Wire<WorkflowNodeKind>>().toExtend<Wire<z.infer<typeof WorkflowNodeKindSchema>>>();

    expectTypeOf<Wire<z.infer<typeof WorkflowSuccessSchema>>>().toExtend<Wire<WorkflowSuccess>>();
    expectTypeOf<Wire<WorkflowSuccess>>().toExtend<Wire<z.infer<typeof WorkflowSuccessSchema>>>();

    expectTypeOf<Wire<z.infer<typeof WorkflowFailureSchema>>>().toExtend<Wire<WorkflowFailure>>();
    expectTypeOf<Wire<WorkflowFailure>>().toExtend<Wire<z.infer<typeof WorkflowFailureSchema>>>();

    expectTypeOf<Wire<z.infer<typeof WorkflowCancellationSchema>>>().toExtend<
      Wire<WorkflowCancellation>
    >();
    expectTypeOf<Wire<WorkflowCancellation>>().toExtend<
      Wire<z.infer<typeof WorkflowCancellationSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof WorkflowWorkerNodeSpecSchema>>>().toExtend<
      Wire<WorkflowWorkerNodeSpec>
    >();
    expectTypeOf<Wire<WorkflowWorkerNodeSpec>>().toExtend<
      Wire<z.infer<typeof WorkflowWorkerNodeSpecSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof WorkflowCoordinatorNodeSpecSchema>>>().toExtend<
      Wire<WorkflowCoordinatorNodeSpec>
    >();
    expectTypeOf<Wire<WorkflowCoordinatorNodeSpec>>().toExtend<
      Wire<z.infer<typeof WorkflowCoordinatorNodeSpecSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof WorkflowHumanNodeSpecSchema>>>().toExtend<
      Wire<WorkflowHumanNodeSpec>
    >();
    expectTypeOf<Wire<WorkflowHumanNodeSpec>>().toExtend<
      Wire<z.infer<typeof WorkflowHumanNodeSpecSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof WorkflowNodeSpecSchema>>>().toExtend<Wire<WorkflowNodeSpec>>();
    expectTypeOf<Wire<WorkflowNodeSpec>>().toExtend<Wire<z.infer<typeof WorkflowNodeSpecSchema>>>();

    expectTypeOf<Wire<z.infer<typeof WorkflowHeaderSchema>>>().toExtend<Wire<WorkflowHeader>>();
    expectTypeOf<Wire<WorkflowHeader>>().toExtend<Wire<z.infer<typeof WorkflowHeaderSchema>>>();

    expectTypeOf<Wire<z.infer<typeof WorkflowNodeSchema>>>().toExtend<Wire<WorkflowNode>>();
    expectTypeOf<Wire<WorkflowNode>>().toExtend<Wire<z.infer<typeof WorkflowNodeSchema>>>();

    expectTypeOf<Wire<z.infer<typeof WorkflowEdgeSchema>>>().toExtend<Wire<WorkflowEdge>>();
    expectTypeOf<Wire<WorkflowEdge>>().toExtend<Wire<z.infer<typeof WorkflowEdgeSchema>>>();

    expectTypeOf<Wire<z.infer<typeof WorkflowDagSchema>>>().toExtend<Wire<WorkflowDag>>();
    expectTypeOf<Wire<WorkflowDag>>().toExtend<Wire<z.infer<typeof WorkflowDagSchema>>>();

    expectTypeOf<Wire<z.infer<typeof CreateWorkflowRequestSchema>>>().toExtend<
      Wire<CreateWorkflowRequest>
    >();
    expectTypeOf<Wire<CreateWorkflowRequest>>().toExtend<
      Wire<z.infer<typeof CreateWorkflowRequestSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof AddNodeRequestSchema>>>().toExtend<Wire<AddNodeRequest>>();
    expectTypeOf<Wire<AddNodeRequest>>().toExtend<Wire<z.infer<typeof AddNodeRequestSchema>>>();

    expectTypeOf<Wire<z.infer<typeof AddNodeResponseSchema>>>().toExtend<Wire<AddNodeResponse>>();
    expectTypeOf<Wire<AddNodeResponse>>().toExtend<Wire<z.infer<typeof AddNodeResponseSchema>>>();

    expectTypeOf<Wire<z.infer<typeof AddEdgeRequestSchema>>>().toExtend<Wire<AddEdgeRequest>>();
    expectTypeOf<Wire<AddEdgeRequest>>().toExtend<Wire<z.infer<typeof AddEdgeRequestSchema>>>();

    expectTypeOf<Wire<z.infer<typeof AddEdgeResponseSchema>>>().toExtend<Wire<AddEdgeResponse>>();
    expectTypeOf<Wire<AddEdgeResponse>>().toExtend<Wire<z.infer<typeof AddEdgeResponseSchema>>>();

    expectTypeOf<Wire<z.infer<typeof WorkflowNodeRefSchema>>>().toExtend<Wire<WorkflowNodeRef>>();
    expectTypeOf<Wire<WorkflowNodeRef>>().toExtend<Wire<z.infer<typeof WorkflowNodeRefSchema>>>();

    expectTypeOf<Wire<z.infer<typeof AddSubgraphRequestNodeSchema>>>().toExtend<
      Wire<AddSubgraphRequestNode>
    >();
    expectTypeOf<Wire<AddSubgraphRequestNode>>().toExtend<
      Wire<z.infer<typeof AddSubgraphRequestNodeSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof AddSubgraphRequestEdgeSchema>>>().toExtend<
      Wire<AddSubgraphRequestEdge>
    >();
    expectTypeOf<Wire<AddSubgraphRequestEdge>>().toExtend<
      Wire<z.infer<typeof AddSubgraphRequestEdgeSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof AddSubgraphRequestSchema>>>().toExtend<
      Wire<AddSubgraphRequest>
    >();
    expectTypeOf<Wire<AddSubgraphRequest>>().toExtend<
      Wire<z.infer<typeof AddSubgraphRequestSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof AddSubgraphResponseInsertedNodeSchema>>>().toExtend<
      Wire<AddSubgraphResponseInsertedNode>
    >();
    expectTypeOf<Wire<AddSubgraphResponseInsertedNode>>().toExtend<
      Wire<z.infer<typeof AddSubgraphResponseInsertedNodeSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof AddSubgraphResponseSchema>>>().toExtend<
      Wire<AddSubgraphResponse>
    >();
    expectTypeOf<Wire<AddSubgraphResponse>>().toExtend<
      Wire<z.infer<typeof AddSubgraphResponseSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof ReplaceNodeSpecRequestSchema>>>().toExtend<
      Wire<ReplaceNodeSpecRequest>
    >();
    expectTypeOf<Wire<ReplaceNodeSpecRequest>>().toExtend<
      Wire<z.infer<typeof ReplaceNodeSpecRequestSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof FinishWorkflowRequestSchema>>>().toExtend<
      Wire<FinishWorkflowRequest>
    >();
    expectTypeOf<Wire<FinishWorkflowRequest>>().toExtend<
      Wire<z.infer<typeof FinishWorkflowRequestSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof CancelWorkflowRequestSchema>>>().toExtend<
      Wire<CancelWorkflowRequest>
    >();
    expectTypeOf<Wire<CancelWorkflowRequest>>().toExtend<
      Wire<z.infer<typeof CancelWorkflowRequestSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof RespondHumanNodeRequestSchema>>>().toExtend<
      Wire<RespondHumanNodeRequest>
    >();
    expectTypeOf<Wire<RespondHumanNodeRequest>>().toExtend<
      Wire<z.infer<typeof RespondHumanNodeRequestSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof WorkflowArtifactMimeBucketSchema>>>().toExtend<
      Wire<WorkflowArtifactMimeBucket>
    >();
    expectTypeOf<Wire<WorkflowArtifactMimeBucket>>().toExtend<
      Wire<z.infer<typeof WorkflowArtifactMimeBucketSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof WorkflowArtifactSchema>>>().toExtend<Wire<WorkflowArtifact>>();
    expectTypeOf<Wire<WorkflowArtifact>>().toExtend<Wire<z.infer<typeof WorkflowArtifactSchema>>>();

    expectTypeOf<Wire<z.infer<typeof WorkflowArtifactsResponseSchema>>>().toExtend<
      Wire<WorkflowArtifactsResponse>
    >();
    expectTypeOf<Wire<WorkflowArtifactsResponse>>().toExtend<
      Wire<z.infer<typeof WorkflowArtifactsResponseSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof WorkflowListQuerySchema>>>().toExtend<
      Wire<WorkflowListQuery>
    >();
    expectTypeOf<Wire<WorkflowListQuery>>().toExtend<
      Wire<z.infer<typeof WorkflowListQuerySchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof WorkflowDeleteQuerySchema>>>().toExtend<
      Wire<WorkflowDeleteQuery>
    >();
    expectTypeOf<Wire<WorkflowDeleteQuery>>().toExtend<
      Wire<z.infer<typeof WorkflowDeleteQuerySchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof WorkflowPathParamsSchema>>>().toExtend<
      Wire<WorkflowPathParams>
    >();
    expectTypeOf<Wire<WorkflowPathParams>>().toExtend<
      Wire<z.infer<typeof WorkflowPathParamsSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof WorkflowNodePathParamsSchema>>>().toExtend<
      Wire<WorkflowNodePathParams>
    >();
    expectTypeOf<Wire<WorkflowNodePathParams>>().toExtend<
      Wire<z.infer<typeof WorkflowNodePathParamsSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof WorkflowEdgePathParamsSchema>>>().toExtend<
      Wire<WorkflowEdgePathParams>
    >();
    expectTypeOf<Wire<WorkflowEdgePathParams>>().toExtend<
      Wire<z.infer<typeof WorkflowEdgePathParamsSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof WorkflowArtifactPathParamsSchema>>>().toExtend<
      Wire<WorkflowArtifactPathParams>
    >();
    expectTypeOf<Wire<WorkflowArtifactPathParams>>().toExtend<
      Wire<z.infer<typeof WorkflowArtifactPathParamsSchema>>
    >();
  });

  it("catalog", () => {
    expectTypeOf<Wire<z.infer<typeof CatalogKindSchema>>>().toExtend<Wire<CatalogKind>>();
    expectTypeOf<Wire<CatalogKind>>().toExtend<Wire<z.infer<typeof CatalogKindSchema>>>();

    expectTypeOf<Wire<z.infer<typeof MissingDepSchema>>>().toExtend<Wire<MissingDep>>();
    expectTypeOf<Wire<MissingDep>>().toExtend<Wire<z.infer<typeof MissingDepSchema>>>();

    expectTypeOf<Wire<z.infer<typeof BlockedReasonSchema>>>().toExtend<Wire<BlockedReason>>();
    expectTypeOf<Wire<BlockedReason>>().toExtend<Wire<z.infer<typeof BlockedReasonSchema>>>();

    expectTypeOf<Wire<z.infer<typeof SkillSchema>>>().toExtend<Wire<Skill>>();
    expectTypeOf<Wire<Skill>>().toExtend<Wire<z.infer<typeof SkillSchema>>>();

    expectTypeOf<Wire<z.infer<typeof AgentSchema>>>().toExtend<Wire<Agent>>();
    expectTypeOf<Wire<Agent>>().toExtend<Wire<z.infer<typeof AgentSchema>>>();

    expectTypeOf<Wire<z.infer<typeof McpSchema>>>().toExtend<Wire<Mcp>>();
    expectTypeOf<Wire<Mcp>>().toExtend<Wire<z.infer<typeof McpSchema>>>();

    expectTypeOf<Wire<z.infer<typeof SkillEntrySchema>>>().toExtend<Wire<SkillEntry>>();
    expectTypeOf<Wire<SkillEntry>>().toExtend<Wire<z.infer<typeof SkillEntrySchema>>>();

    expectTypeOf<Wire<z.infer<typeof AgentEntrySchema>>>().toExtend<Wire<AgentEntry>>();
    expectTypeOf<Wire<AgentEntry>>().toExtend<Wire<z.infer<typeof AgentEntrySchema>>>();

    expectTypeOf<Wire<z.infer<typeof InstallSkillRequestSchema>>>().toExtend<
      Wire<InstallSkillRequest>
    >();
    expectTypeOf<Wire<InstallSkillRequest>>().toExtend<
      Wire<z.infer<typeof InstallSkillRequestSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof InstallAgentRequestSchema>>>().toExtend<
      Wire<InstallAgentRequest>
    >();
    expectTypeOf<Wire<InstallAgentRequest>>().toExtend<
      Wire<z.infer<typeof InstallAgentRequestSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof CatalogConflictSchema>>>().toExtend<Wire<CatalogConflict>>();
    expectTypeOf<Wire<CatalogConflict>>().toExtend<Wire<z.infer<typeof CatalogConflictSchema>>>();

    expectTypeOf<Wire<z.infer<typeof CatalogInstallResultSchema>>>().toExtend<
      Wire<CatalogInstallResult>
    >();
    expectTypeOf<Wire<CatalogInstallResult>>().toExtend<
      Wire<z.infer<typeof CatalogInstallResultSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof CatalogSyncResultSchema>>>().toExtend<
      Wire<CatalogSyncResult>
    >();
    expectTypeOf<Wire<CatalogSyncResult>>().toExtend<
      Wire<z.infer<typeof CatalogSyncResultSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof CatalogFileEntrySchema>>>().toExtend<Wire<CatalogFileEntry>>();
    expectTypeOf<Wire<CatalogFileEntry>>().toExtend<Wire<z.infer<typeof CatalogFileEntrySchema>>>();

    expectTypeOf<Wire<z.infer<typeof SyncCatalogRequestSchema>>>().toExtend<
      Wire<SyncCatalogRequest>
    >();
    expectTypeOf<Wire<SyncCatalogRequest>>().toExtend<
      Wire<z.infer<typeof SyncCatalogRequestSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof CatalogOverviewSchema>>>().toExtend<Wire<CatalogOverview>>();
    expectTypeOf<Wire<CatalogOverview>>().toExtend<Wire<z.infer<typeof CatalogOverviewSchema>>>();

    expectTypeOf<Wire<z.infer<typeof SkillWithContentSchema>>>().toExtend<Wire<SkillWithContent>>();
    expectTypeOf<Wire<SkillWithContent>>().toExtend<Wire<z.infer<typeof SkillWithContentSchema>>>();

    expectTypeOf<Wire<z.infer<typeof AgentWithContentSchema>>>().toExtend<Wire<AgentWithContent>>();
    expectTypeOf<Wire<AgentWithContent>>().toExtend<Wire<z.infer<typeof AgentWithContentSchema>>>();

    expectTypeOf<Wire<z.infer<typeof AnchorResponseSchema>>>().toExtend<Wire<AnchorResponse>>();
    expectTypeOf<Wire<AnchorResponse>>().toExtend<Wire<z.infer<typeof AnchorResponseSchema>>>();

    expectTypeOf<Wire<z.infer<typeof McpWithContentSchema>>>().toExtend<Wire<McpWithContent>>();
    expectTypeOf<Wire<McpWithContent>>().toExtend<Wire<z.infer<typeof McpWithContentSchema>>>();

    expectTypeOf<Wire<z.infer<typeof OkResponseSchema>>>().toExtend<Wire<OkResponse>>();
    expectTypeOf<Wire<OkResponse>>().toExtend<Wire<z.infer<typeof OkResponseSchema>>>();

    expectTypeOf<Wire<z.infer<typeof CatalogResourcePathParamsSchema>>>().toExtend<
      Wire<CatalogResourcePathParams>
    >();
    expectTypeOf<Wire<CatalogResourcePathParams>>().toExtend<
      Wire<z.infer<typeof CatalogResourcePathParamsSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof OrphanManifestEntrySchema>>>().toExtend<
      Wire<OrphanManifestEntry>
    >();
    expectTypeOf<Wire<OrphanManifestEntry>>().toExtend<
      Wire<z.infer<typeof OrphanManifestEntrySchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof SkillManifestNodeSchema>>>().toExtend<
      Wire<SkillManifestNode>
    >();
    expectTypeOf<Wire<SkillManifestNode>>().toExtend<
      Wire<z.infer<typeof SkillManifestNodeSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof AgentManifestNodeSchema>>>().toExtend<
      Wire<AgentManifestNode>
    >();
    expectTypeOf<Wire<AgentManifestNode>>().toExtend<
      Wire<z.infer<typeof AgentManifestNodeSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof McpManifestNodeSchema>>>().toExtend<Wire<McpManifestNode>>();
    expectTypeOf<Wire<McpManifestNode>>().toExtend<Wire<z.infer<typeof McpManifestNodeSchema>>>();

    expectTypeOf<Wire<z.infer<typeof ResolveManifestNodeSchema>>>().toExtend<
      Wire<ResolveManifestNode>
    >();
    expectTypeOf<Wire<ResolveManifestNode>>().toExtend<
      Wire<z.infer<typeof ResolveManifestNodeSchema>>
    >();

    expectTypeOf<Wire<z.infer<typeof ResolveManifestSchema>>>().toExtend<Wire<ResolveManifest>>();
    expectTypeOf<Wire<ResolveManifest>>().toExtend<Wire<z.infer<typeof ResolveManifestSchema>>>();
  });
});
