/**
 * Re-exports of the domain types that cross the HTTP wire.
 *
 * Hosted here so the SDK (and through it, dashboard and CLI) can pull
 * every shape they need without taking a workspace dep on the
 * underlying domain pkg. Importing the source pkg would let the
 * consumer accidentally pull non-wire surfaces (DB handles, service
 * classes) into its module graph.
 *
 * All re-exports MUST be type-only. Value re-exports belong in the
 * orchestration barrel proper (`../index.ts`), not this wire subtree.
 */

export type {
  CatalogConflict,
  CatalogKind,
  ListAgentEntriesResponse,
  ListSkillEntriesResponse,
} from "@glyphs-ai/catalog";
export type { ActivityItem, TruncationInfo } from "@glyphs-ai/runtime";
export type { PreviewScheduleResult, Schedule } from "@glyphs-ai/schedule";
export type { Task } from "@glyphs-ai/task";
export type {
  WorkflowCancellation,
  WorkflowFailure,
  WorkflowNodeKind,
  WorkflowNodeStatus,
  WorkflowOrigin,
  WorkflowStatus,
  WorkflowSuccess,
} from "@glyphs-ai/workflow";
export type {
  Agent,
  AgentEntry,
  BlockedReason,
  Mcp,
  MissingDep,
  Skill,
  SkillEntry,
} from "../schemas/catalog.js";
