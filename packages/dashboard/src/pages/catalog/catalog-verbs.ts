import type { CatalogKind } from "@glyphs-ai/contracts";
import {
  deleteAgent,
  deleteMcp,
  deleteSkill,
  disableAgent,
  enableAgent,
  type InstallResult,
  type InstallSource,
  installAgent,
  installMcp,
  installSkill,
  type ResolveManifest,
  resolveAgentInstall,
  resolveSkillInstall,
} from "../../api";
import { KIND_TITLE } from "../../kind-meta";

/**
 * Plural URL segment that names a catalog tab — the value the
 * dashboard's React Router exposes via the `:tab` segment and
 * the historical key used by `KIND_LABEL`. The singular
 * {@link CatalogKind} from `@glyphs-ai/catalog` is the canonical
 * discriminator everywhere else; this tab type only exists to
 * mediate the URL / route boundary.
 */
export type CatalogTab = "agents" | "skills" | "mcps";

/** Singular kind → plural tab segment. */
export const KIND_TAB: Record<CatalogKind, CatalogTab> = {
  agent: "agents",
  skill: "skills",
  mcp: "mcps",
};

/** Plural tab segment → singular kind. Inverse of {@link KIND_TAB}. */
export const TAB_KIND: Record<CatalogTab, CatalogKind> = {
  agents: "agent",
  skills: "skill",
  mcps: "mcp",
};

/** Agent-only lifecycle verbs. `null` on every non-agent kind. */
export interface AgentLifecycleVerbs {
  enable: (name: string) => Promise<void>;
  disable: (name: string) => Promise<void>;
}

/**
 * Per-kind dispatch table for catalog entity operations. Adding a
 * fourth catalog kind is a matter of adding one entry here plus its api
 * wiring — the page + dialogs require no further edits.
 */
export interface CatalogKindVerbs {
  /** The singular kind discriminator this entry covers. */
  kind: CatalogKind;
  /** Plural tab segment — the URL the dashboard routes the kind under. */
  tab: CatalogTab;
  /** Title-case prose label (e.g. "Agent" / "Skill" / "MCP"). */
  title: string;

  // ─── install ─────────────────────────────────────────────────────
  install: (src: InstallSource) => Promise<InstallResult>;
  /**
   * Two-phase install preview. `null` for MCPs — they are leaf
   * entries with no dep graph to render, and the FQN is recovered
   * from `_meta.name` server-side at install time.
   */
  resolveInstall: ((src: InstallSource) => Promise<ResolveManifest>) | null;

  // ─── remove ──────────────────────────────────────────────────────
  remove: (name: string) => Promise<void>;

  // ─── lifecycle ───────────────────────────────────────────────────
  /** Agent-only enable/disable verbs. `null` for skill + mcp. */
  lifecycle: AgentLifecycleVerbs | null;
}

/**
 * Dispatch table for every per-kind operation the catalog page + its
 * dialogs perform. Lookup is `CATALOG_VERBS[kind]`; the page should
 * never branch on the kind discriminator directly.
 */
export const CATALOG_VERBS: Record<CatalogKind, CatalogKindVerbs> = {
  agent: {
    kind: "agent",
    tab: "agents",
    title: KIND_TITLE.agent,
    install: installAgent,
    resolveInstall: resolveAgentInstall,
    remove: deleteAgent,
    lifecycle: { enable: enableAgent, disable: disableAgent },
  },
  skill: {
    kind: "skill",
    tab: "skills",
    title: KIND_TITLE.skill,
    install: installSkill,
    resolveInstall: resolveSkillInstall,
    remove: deleteSkill,
    lifecycle: null,
  },
  mcp: {
    kind: "mcp",
    tab: "mcps",
    title: KIND_TITLE.mcp,
    install: installMcp,
    resolveInstall: null,
    remove: deleteMcp,
    lifecycle: null,
  },
};
