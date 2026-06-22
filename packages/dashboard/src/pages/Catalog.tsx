import type { AgentEntry, CatalogKind, SkillEntry } from "@glyphs-ai/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { InstallSource, McpItem } from "../api";
import { DetailDialog } from "../components/DetailDialog";
import { EntryGrid } from "../components/EntryGrid";
import { HeaderActions } from "../components/HeaderActions";
import { PlusIcon } from "../components/Icons";
import { McpGrid } from "../components/McpGrid";
import { useUrlSearchValue } from "../hooks/useUrlState";
import { CATALOG_VERBS, type CatalogTab, TAB_KIND } from "./catalog/catalog-verbs";
import { FilterMenu, type StatusFilter } from "./catalog/FilterMenu";
import { InstallDialog } from "./catalog/InstallDialog";
import { RmDialog } from "./catalog/RmDialog";

export type { CatalogTab } from "./catalog/catalog-verbs";

interface CatalogProps {
  tab: CatalogTab;
  onTabChange: (tab: CatalogTab) => void;
  skills: SkillEntry[];
  agents: AgentEntry[];
  mcps: McpItem[];
  currentWorkspaceId: string | null;
  onChanged: () => void;
}

type EditTarget = { kind: CatalogKind; name: string };

export function CatalogPage({
  tab,
  onTabChange,
  skills,
  agents,
  mcps,
  currentWorkspaceId,
  onChanged,
}: CatalogProps) {
  const tabVerbs = CATALOG_VERBS[TAB_KIND[tab]];

  const [installOpen, setInstallOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Reset on tab change so an unreachable filter (e.g. Blocked on MCPs) doesn't stick.
  // biome-ignore lint/correctness/useExhaustiveDependencies: setStatusFilter is stable; tab change is the trigger
  useEffect(() => {
    setStatusFilter("all");
  }, [tab]);

  // Filtering per status pill. `orphaned` is only meaningful for skills + mcps;
  // FilterMenu hides the option for the agents tab.
  const filteredAgents = useMemo(() => {
    if (statusFilter === "all") return agents;
    if (statusFilter === "ready") return agents.filter((a) => a.status === "ready");
    if (statusFilter === "blocked") return agents.filter((a) => a.status === "blocked");
    return agents;
  }, [agents, statusFilter]);

  // `?agent=<fqn>` deep-link.
  const [agentHint] = useUrlSearchValue("agent", "");
  const appliedAgentHighlightRef = useRef<string | null>(null);
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (tab !== "agents") {
      appliedAgentHighlightRef.current = null;
      return;
    }
    if (agentHint === "" || agentHint === null) return;
    if (appliedAgentHighlightRef.current === agentHint) return;

    const selector = `.card-grid__item[data-entry-name="${CSS.escape(agentHint)}"]`;
    const row = document.querySelector<HTMLElement>(selector);
    if (!row) return; // Silent no-op on miss (stale link / uninstalled agent).

    appliedAgentHighlightRef.current = agentHint;
    row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    row.classList.add("card-grid__item--highlight");
    const t = window.setTimeout(() => {
      row.classList.remove("card-grid__item--highlight");
    }, 2000);
    return () => {
      window.clearTimeout(t);
      row.classList.remove("card-grid__item--highlight");
    };
  }, [agentHint, tab]);

  // `?entry=<fqn>` deep-link — auto-opens the entry's dialog when the
  // current tab's list contains a match. Used by DetailDialog dep
  // chips and any external link into a specific catalog entry.
  // `appliedEntryRef` tracks the last-opened value so a parent re-fetch
  // that retains `?entry=` doesn't re-open a dialog the user just closed.
  const [entryParam, setEntryParam] = useUrlSearchValue("entry", "");
  const appliedEntryRef = useRef<string | null>(null);
  useEffect(() => {
    if (entryParam === "") {
      appliedEntryRef.current = null;
      return;
    }
    if (appliedEntryRef.current === entryParam) return;
    const kind = TAB_KIND[tab];
    if (kind === "agent") {
      const a = agents.find((x) => x.agent.fqn === entryParam);
      if (!a) return; // Silent no-op while the list loads or on stale link.
      appliedEntryRef.current = entryParam;
      setError(null);
      setEdit({ kind: "agent", name: entryParam });
    } else if (kind === "skill") {
      const s = skills.find((x) => x.skill.fqn === entryParam);
      if (!s) return;
      appliedEntryRef.current = entryParam;
      setError(null);
      setEdit({ kind: "skill", name: entryParam });
    } else {
      const m = mcps.find((x) => x.fqn === entryParam);
      if (!m) return;
      appliedEntryRef.current = entryParam;
      setError(null);
      setEdit({ kind: "mcp", name: entryParam });
    }
  }, [entryParam, tab, agents, skills, mcps]);

  // Centralised dialog-close hook so the ?entry= URL key is always
  // stripped alongside the in-memory edit state.
  const closeEdit = () => {
    setEdit(null);
    if (entryParam !== "") setEntryParam("");
  };
  const closeEditAndRefresh = () => {
    closeEdit();
    onChanged();
  };

  const filteredSkills = useMemo(() => {
    if (statusFilter === "all") return skills;
    if (statusFilter === "ready") return skills.filter((s) => s.status === "ready");
    if (statusFilter === "blocked") return skills.filter((s) => s.status === "blocked");
    return skills.filter((s) => s.skill.orphaned);
  }, [skills, statusFilter]);

  const filteredMcps = useMemo(() => {
    if (statusFilter === "all") return mcps;
    if (statusFilter === "ready") return mcps.filter((m) => !m.orphaned);
    return mcps.filter((m) => m.orphaned);
  }, [mcps, statusFilter]);

  const orphanCount = useMemo(() => {
    if (tab === "skills") return skills.filter((s) => s.skill.orphaned).length;
    if (tab === "mcps") return mcps.filter((m) => m.orphaned).length;
    return 0;
  }, [tab, skills, mcps]);

  // Shared busy/error/refresh wrapper for the simple page-level mutations.
  // Per-entry prereqs/prereqsAck on install responses are surfaced via the
  // entry's own `blocked` badge + DetailDialog, not a page banner.
  const runMutation = async (op: () => Promise<unknown>, after: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await op();
      after();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const doInstall = (src: InstallSource) =>
    runMutation(
      () => tabVerbs.install(src),
      () => setInstallOpen(false),
    );

  const doRemove = (name: string) =>
    runMutation(
      () => tabVerbs.remove(name),
      () => setConfirmRemove(null),
    );

  // Bulk-delete every orphaned entry on the active tab. Only skills/mcps surface
  // orphans (agents are roots); branching is on source-array shape, not kind.
  const doRemoveAllOrphans = async () => {
    setBusy(true);
    setError(null);
    const bulkRemove = async (fqns: string[], remove: (n: string) => Promise<void>) => {
      for (const fqn of fqns) {
        try {
          await remove(fqn);
        } catch (e) {
          setError(`failed to remove ${fqn}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    };
    try {
      if (tab === "skills") {
        await bulkRemove(
          skills.filter((s) => s.skill.orphaned).map((s) => s.skill.fqn),
          CATALOG_VERBS.skill.remove,
        );
      } else if (tab === "mcps") {
        await bulkRemove(
          mcps.filter((m) => m.orphaned).map((m) => m.fqn),
          CATALOG_VERBS.mcp.remove,
        );
      }
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {currentWorkspaceId === null ? (
        <div className="alert alert--error">
          No workspace is selected. Use the workspace dropdown in the top bar to choose or create
          one — the catalog is scoped to a workspace.
        </div>
      ) : (
        <>
          <HeaderActions>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                setError(null);
                setInstallOpen(true);
              }}
            >
              <PlusIcon />
              Install {tabVerbs.title}
            </button>
          </HeaderActions>
          <div className="page-toolbar">
            <nav className="section-tabs">
              {(
                [
                  ["agents", "Agents", agents.length],
                  ["skills", "Skills", skills.length],
                  ["mcps", "MCPs", mcps.length],
                ] as const
              ).map(([t, label, count]) => (
                <button
                  key={t}
                  type="button"
                  className={tab === t ? "active" : ""}
                  onClick={() => onTabChange(t)}
                >
                  {label} <span className="count">{count}</span>
                </button>
              ))}
            </nav>
            <div className="page-toolbar__actions">
              <FilterMenu
                tab={tab}
                value={statusFilter}
                onChange={setStatusFilter}
                orphanCount={orphanCount}
              />
              {statusFilter === "orphaned" && orphanCount > 0 && tab !== "agents" && (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={doRemoveAllOrphans}
                  disabled={busy}
                  title="Delete every orphaned entry. Each delete is guarded against accidentally removing one with dependents."
                >
                  {busy ? "Removing…" : `Remove all (${orphanCount})`}
                </button>
              )}
            </div>
          </div>

          {error && !installOpen && !confirmRemove && (
            <div className="alert alert--error" style={{ marginBottom: 16 }}>
              ⚠ {error}
            </div>
          )}

          {tab === "agents" && (
            <EntryGrid
              kind="agent"
              items={filteredAgents.map((a) => ({
                name: a.agent.fqn,
                description: a.agent.description,
                version: a.agent.version,
                status: a.status,
                ...(a.blockedReason !== undefined ? { blockedReason: a.blockedReason } : {}),
                missingDeps: a.missingDeps,
                skillsCount: a.agent.dependencies?.skills?.length ?? 0,
                mcpsCount: a.agent.dependencies?.mcps?.length ?? 0,
                agentsCount: a.agent.dependencies?.agents?.length ?? 0,
              }))}
              emptyTitle="No agents installed"
              emptyHint={<>Agents wrap skills + MCPs into runnable templates.</>}
              onEdit={(name) => {
                setError(null);
                setEdit({ kind: "agent", name });
              }}
              onRemove={setConfirmRemove}
            />
          )}

          {tab === "skills" && (
            <EntryGrid
              kind="skill"
              items={filteredSkills.map((s) => ({
                name: s.skill.fqn,
                description: s.skill.description,
                version: s.skill.version,
                status: s.status,
                ...(s.blockedReason !== undefined ? { blockedReason: s.blockedReason } : {}),
                missingDeps: s.missingDeps,
                skillsCount: s.skill.dependencies?.skills?.length ?? 0,
                mcpsCount: s.skill.dependencies?.mcps?.length ?? 0,
              }))}
              emptyTitle="No skills installed"
              emptyHint={<>A skill is a reusable capability package referenced by agents.</>}
              onEdit={(name) => {
                setError(null);
                setEdit({ kind: "skill", name });
              }}
              onRemove={setConfirmRemove}
            />
          )}

          {tab === "mcps" && (
            <McpGrid
              mcps={filteredMcps}
              onEdit={(name) => {
                setError(null);
                setEdit({ kind: "mcp", name });
              }}
              onRemove={setConfirmRemove}
            />
          )}

          <InstallDialog
            kind={TAB_KIND[tab]}
            open={installOpen}
            busy={busy}
            error={error}
            onClose={() => {
              setInstallOpen(false);
              setError(null);
            }}
            onSubmit={doInstall}
          />

          <RmDialog
            kind={TAB_KIND[tab]}
            name={confirmRemove}
            busy={busy}
            error={error}
            onClose={() => {
              setConfirmRemove(null);
              setError(null);
            }}
            onConfirm={() => confirmRemove && doRemove(confirmRemove)}
          />

          {edit !== null && (
            <DetailDialog
              target={{ kind: edit.kind, name: edit.name }}
              workspaceId={currentWorkspaceId}
              onClose={closeEdit}
              onSynced={closeEditAndRefresh}
            />
          )}
        </>
      )}
    </div>
  );
}
