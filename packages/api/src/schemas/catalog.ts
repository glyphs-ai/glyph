/**
 * zod schemas for the `/api/workspaces/:id/catalog/**` wire shapes.
 * Mirrors the catalog DTOs re-exported from `@glyphs-ai/contracts`
 * (`Skill` / `Agent` / `Mcp` / entries / install + sync results from
 * `@glyphs-ai/catalog`), the contracts-local route wrappers in
 * `routes/catalog.ts`, and the `ResolveManifest` projection in
 * `plan-to-manifest.ts`; parity pinned by the wire-schema parity test.
 */
import { z } from "zod";

// ─── Shared enums ─────────────────────────────────────────────────

export const CatalogKindSchema = z.enum(["skill", "agent", "mcp"]);

const EntryStatusSchema = z.enum(["ready", "blocked"]);

const DependencyKindSchema = z.enum(["skill", "mcp"]);

// ─── Dependency + blocked-reason payloads ─────────────────────────

const DependencyRefSchema = z.object({
  fqn: z.string(),
});

export const MissingDepSchema = z.object({
  kind: DependencyKindSchema,
  name: z.string(),
});

const BlockedDepSchema = z.object({
  kind: DependencyKindSchema,
  fqn: z.string(),
});

export const BlockedReasonSchema = z.object({
  needsPrereqsAck: z.literal(true).optional(),
  disabledByUser: z.literal(true).optional(),
  orphaned: z.literal(true).optional(),
  missingDeps: z.array(MissingDepSchema).optional(),
  blockedDeps: z.array(BlockedDepSchema).optional(),
});

// ─── Resource DTOs ────────────────────────────────────────────────

export const SkillSchema = z.object({
  fqn: z.string(),
  origin: z.string(),
  description: z.string(),
  version: z.string(),
  prereqs: z.string().optional(),
  prereqsAck: z.boolean(),
  orphaned: z.boolean(),
  installedAt: z.string(),
  updatedAt: z.string(),
  dependencies: z
    .object({
      skills: z.array(DependencyRefSchema).optional(),
      mcps: z.array(DependencyRefSchema).optional(),
    })
    .optional(),
});

export const AgentSchema = z.object({
  fqn: z.string(),
  origin: z.string(),
  description: z.string(),
  version: z.string(),
  prereqs: z.string().optional(),
  prereqsAck: z.boolean(),
  disabledByUser: z.boolean(),
  installedAt: z.string(),
  updatedAt: z.string(),
  dependencies: z
    .object({
      skills: z.array(DependencyRefSchema).optional(),
      mcps: z.array(DependencyRefSchema).optional(),
      agents: z.array(DependencyRefSchema).optional(),
    })
    .optional(),
});

export const McpSchema = z.object({
  fqn: z.string(),
  origin: z.string(),
  orphaned: z.boolean(),
  installedAt: z.string(),
  updatedAt: z.string(),
});

export const SkillEntrySchema = z.object({
  skill: SkillSchema,
  status: EntryStatusSchema,
  blockedReason: BlockedReasonSchema.optional(),
  missingDeps: z.array(MissingDepSchema).optional(),
});

export const AgentEntrySchema = z.object({
  agent: AgentSchema,
  status: EntryStatusSchema,
  blockedReason: BlockedReasonSchema.optional(),
  missingDeps: z.array(MissingDepSchema).optional(),
  coordEligible: z.boolean(),
});

// ─── Install request bodies ───────────────────────────────────────

export const InstallSkillRequestSchema = z.object({
  origin: z.string(),
});

export const InstallAgentRequestSchema = z.object({
  origin: z.string(),
});

// ─── Install + sync result shapes ─────────────────────────────────

const CatalogInstalledEntrySchema = z.object({
  kind: CatalogKindSchema,
  fqn: z.string(),
  prereqs: z.string().optional(),
  prereqsAck: z.boolean().optional(),
});

const CatalogInstallFailureSchema = z.object({
  kind: CatalogKindSchema,
  fqn: z.string(),
  error: z.object({
    name: z.string(),
    message: z.string(),
  }),
});

const CatalogInstallSkipSchema = z.object({
  kind: CatalogKindSchema,
  fqn: z.string(),
  reason: z.enum(["already-installed", "dep-failed", "up-to-date"]),
});

const OrphanedEntrySchema = z.object({
  kind: DependencyKindSchema,
  fqn: z.string(),
  origin: z.string(),
});

const CatalogConflictReasonSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fetch-failed"), cause: z.unknown() }),
  z.object({ kind: z.literal("parse-failed"), cause: z.unknown() }),
  z.object({ kind: z.literal("origin-conflict"), existingOrigin: z.string() }),
]);

export const CatalogConflictSchema = z.object({
  kind: CatalogKindSchema,
  origin: z.string(),
  fqn: z.string().nullable(),
  reason: CatalogConflictReasonSchema,
});

export const CatalogInstallResultSchema = z.object({
  installed: z.array(CatalogInstalledEntrySchema),
  skipped: z.array(CatalogInstallSkipSchema),
  failed: z.array(CatalogInstallFailureSchema),
  conflicts: z.array(CatalogConflictSchema),
});

export const CatalogSyncResultSchema = CatalogInstallResultSchema.extend({
  orphansFlagged: z.array(OrphanedEntrySchema),
});

// ─── Contracts-local route wrappers ───────────────────────────────

export const CatalogFileEntrySchema = z.object({
  relPath: z.string(),
  size: z.number(),
});

export const SyncCatalogRequestSchema = z.object({
  planToken: z.string(),
});

export const CatalogOverviewSchema = z.object({
  counts: z.object({
    skills: z.number(),
    agents: z.number(),
    mcps: z.number(),
    blocked: z.number(),
    orphaned: z.number(),
  }),
});

export const SkillWithContentSchema = SkillEntrySchema.extend({
  content: z.string(),
});

export const AgentWithContentSchema = AgentEntrySchema.extend({
  content: z.string(),
});

export const AnchorResponseSchema = z.object({
  content: z.string(),
});

export const McpWithContentSchema = McpSchema.extend({
  content: z.string(),
});

export const OkResponseSchema = z.object({
  ok: z.literal(true),
});

export const CatalogResourcePathParamsSchema = z.object({
  id: z.string(),
  scope: z.string(),
  name: z.string(),
});

// ─── Resolve manifest (install + sync preview projection) ─────────

export const OrphanManifestEntrySchema = z.object({
  kind: DependencyKindSchema,
  fqn: z.string(),
  origin: z.string(),
});

const ManifestNodeStatusSchema = z.enum([
  "new",
  "will-sync",
  "already-installed",
  "up-to-date",
  "identity-changed",
  "would-conflict",
  "fetch-failed",
  "parse-failed",
]);

const manifestBaseNodeShape = {
  origin: z.string(),
  fqn: z.string(),
  status: ManifestNodeStatusSchema,
  dependencyOrigins: z.array(z.string()),
  identityChange: z.object({ oldFqn: z.string(), newFqn: z.string() }).optional(),
  error: z.object({ name: z.string(), message: z.string() }).optional(),
};

export const SkillManifestNodeSchema = z.object({
  ...manifestBaseNodeShape,
  kind: z.literal("skill"),
  shortName: z.string(),
  scope: z.string(),
});

export const AgentManifestNodeSchema = z.object({
  ...manifestBaseNodeShape,
  kind: z.literal("agent"),
  shortName: z.string(),
  scope: z.string(),
});

export const McpManifestNodeSchema = z.object({
  ...manifestBaseNodeShape,
  kind: z.literal("mcp"),
  specName: z.string(),
});

export const ResolveManifestNodeSchema = z.discriminatedUnion("kind", [
  SkillManifestNodeSchema,
  AgentManifestNodeSchema,
  McpManifestNodeSchema,
]);

export const ResolveManifestSchema = z.object({
  rootOrigin: z.string(),
  rootFqn: z.string(),
  isSync: z.boolean(),
  planToken: z.string().optional(),
  upToDate: z.boolean(),
  identityChange: z
    .object({
      kind: CatalogKindSchema,
      oldFqn: z.string(),
      newFqn: z.string(),
    })
    .optional(),
  orphans: z.array(OrphanManifestEntrySchema),
  nodes: z.array(ResolveManifestNodeSchema),
});
