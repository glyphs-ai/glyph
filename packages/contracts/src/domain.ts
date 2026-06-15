/**
 * Re-exports of the domain types that cross the HTTP wire.
 *
 * Hosted here so dashboard and CLI can pull every shape they need
 * through `@glyphs-ai/contracts` without taking a workspace dep on
 * the underlying domain pkg. Importing the source pkg would let the
 * consumer accidentally pull non-wire surfaces (DB handles, service
 * classes) into its module graph.
 *
 * All re-exports MUST be type-only. Value re-exports belong in
 * `@glyphs-ai/api` (the orchestration root), which has fewer caller
 * categories and tighter audit.
 */

export type {
  Agent,
  AgentEntry,
  AgentInstallBody,
  AgentMetadataPatch,
  BlockedReason,
  CatalogConflict,
  CatalogInstallResult,
  CatalogKind,
  CatalogSyncResult,
  Mcp,
  MissingDep,
  Skill,
  SkillEntry,
  SkillInstallBody,
  SkillMetadataPatch,
} from "@glyphs-ai/catalog";
export type { ActivityItem, TruncationInfo } from "@glyphs-ai/runtime";
export type { PreviewScheduleResult, Schedule } from "@glyphs-ai/schedule";
export type { Session } from "@glyphs-ai/session";
export type { Task } from "@glyphs-ai/task";
