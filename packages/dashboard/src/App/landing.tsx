import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getServerCurrentWorkspace,
  listWorkspaces,
  setActiveWorkspace,
  type WorkspaceListItem,
} from "../api";
import { GitHubMark, PlusIcon, SearchIcon, TrashIcon } from "../components/Icons";
import { formatRelative } from "../utils/time";
import { AddWorkspaceModal, RemoveWorkspaceModal } from "./workspace-modals";

/**
 * Decorative SVG that sits to the left of the wordmark in a brand
 * "lockup" — a hexagonal "glyph" with a soft glow that picks up the
 * wordmark's gradient palette. Purely presentational, aria-hidden, no
 * semantic content.
 */
function BrandGlyph() {
  return (
    <div className="landing__brand-glyph" aria-hidden="true">
      <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <linearGradient id="brandGlyphStroke" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#2563eb" />
            <stop offset="55%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
          <radialGradient id="brandGlyphGlow" cx="50%" cy="50%" r="55%">
            <stop offset="0%" stopColor="rgba(99,102,241,0.32)" />
            <stop offset="55%" stopColor="rgba(99,102,241,0.08)" />
            <stop offset="100%" stopColor="rgba(99,102,241,0)" />
          </radialGradient>
        </defs>
        <circle cx="60" cy="60" r="60" fill="url(#brandGlyphGlow)" />
        <polygon
          points="60,20 95,40 95,80 60,100 25,80 25,40"
          fill="none"
          stroke="url(#brandGlyphStroke)"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <line
          x1="60"
          y1="20"
          x2="60"
          y2="100"
          stroke="url(#brandGlyphStroke)"
          strokeWidth="1"
          opacity="0.45"
        />
        <line
          x1="25"
          y1="40"
          x2="95"
          y2="80"
          stroke="url(#brandGlyphStroke)"
          strokeWidth="1"
          opacity="0.45"
        />
        <line
          x1="95"
          y1="40"
          x2="25"
          y2="80"
          stroke="url(#brandGlyphStroke)"
          strokeWidth="1"
          opacity="0.45"
        />
      </svg>
    </div>
  );
}

/**
 * Hub landing page. Asymmetric split layout — left panel carries the
 * Glyph wordmark + tagline; right panel is the operational area
 * (workspace picker, "Add workspace"). Acts as both the entry point
 * (`/`) and the fallback for any unknown URL  `*` redirects here. The
 * server's last-opened workspace is highlighted but never auto-navigated;
 * the user always picks. Keeps multi-tab usage predictable.
 */
export function LandingPage() {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<WorkspaceListItem[] | null>(null);
  const [recent, setRecent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const [list, sc] = await Promise.all([
        listWorkspaces(),
        getServerCurrentWorkspace().catch(() => ({ id: null as string | null })),
      ]);
      setWorkspaces(list);
      setRecent(sc.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setWorkspaces([]);
    }
  }, []);

  // Clear the active-workspace slot whenever the landing page is shown so
  // any background API call from a stale layout doesn't leak across.
  useLayoutEffect(() => {
    setActiveWorkspace(null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enterWorkspace = useCallback(
    (id: string) => {
      navigate(`/workspaces/${encodeURIComponent(id)}/overview`);
    },
    [navigate],
  );

  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<WorkspaceListItem | null>(null);
  const [query, setQuery] = useState("");

  // Sort: recent first, then ok before broken, then by display name.
  const ordered = useMemo(() => {
    const sorted = (workspaces ?? []).slice().sort((a, b) => {
      if (a.id === recent && b.id !== recent) return -1;
      if (b.id === recent && a.id !== recent) return 1;
      const aDisplay = a.name ?? a.id;
      const bDisplay = b.name ?? b.id;
      return aDisplay.localeCompare(bDisplay);
    });
    const needle = query.trim().toLowerCase();
    if (!needle) return sorted;
    return sorted.filter((ws) => (ws.name ?? "").toLowerCase().includes(needle));
  }, [workspaces, recent, query]);

  return (
    <div className="landing">
      <header className="landing__topbar">
        <div className="landing__topbar-brand">
          <BrandGlyph />
          <h1 className="landing__topbar-wordmark">Glyph</h1>
        </div>
        <div className="landing__topbar-actions">
          <div className="landing__search">
            <SearchIcon />
            <input
              type="search"
              className="landing__search-input"
              placeholder="Search workspaces"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search workspaces"
            />
          </div>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              setError(null);
              setAddOpen(true);
            }}
          >
            <PlusIcon /> Add workspace
          </button>
        </div>
      </header>

      <main className="landing__main">
        {error && <div className="alert alert--error"> {error}</div>}

        <div className="landing__section-header">
          <h2 className="landing__section-title">
            My Workspaces
            {workspaces !== null && (
              <span className="landing__section-count">{workspaces.length}</span>
            )}
          </h2>
        </div>

        {workspaces === null ? (
          <p className="muted">Loading</p>
        ) : workspaces.length === 0 ? (
          <div className="landing__empty">
            <p className="landing__empty-title">No workspaces registered yet</p>
            <p className="muted">
              A workspace pins Glyph to one project on disk. Add one and everything in the sidebar —
              sessions, agents, tasks, schedules — starts from there.
            </p>
          </div>
        ) : ordered.length === 0 ? (
          <div className="landing__empty">
            <p className="landing__empty-title">No matches</p>
            <p className="muted">No workspaces match the current search.</p>
          </div>
        ) : (
          <div className="landing__grid">
            {ordered.map((ws) => {
              const display = ws.name ?? ws.id;
              const isRecent = ws.id === recent;
              const enter = () => {
                enterWorkspace(ws.id);
              };
              return (
                // biome-ignore lint/a11y/useSemanticElements: card has nested Remove <button>; nesting buttons is invalid HTML
                <div
                  key={ws.id}
                  className="landing__card"
                  role="button"
                  tabIndex={0}
                  onClick={enter}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      enter();
                    }
                  }}
                  title={`Open ${display}`}
                >
                  <div className="landing__card-body">
                    <div className="landing__card-header">
                      <span className="landing__card-name">{display}</span>
                      {isRecent && <span className="landing__card-badge">Recent</span>}
                    </div>
                    <div className="landing__card-path" title={ws.workspaceDir}>
                      {ws.workspaceDir}
                    </div>
                    <div className="landing__card-footer">
                      <span className="landing__card-meta">
                        {`Created ${formatRelative(ws.createdAt)}`}
                      </span>
                      <button
                        type="button"
                        className="landing__card-remove"
                        onClick={(e) => {
                          e.stopPropagation();
                          setError(null);
                          setRemoveTarget(ws);
                        }}
                        aria-label={`Remove ${display}`}
                        title={`Remove "${display}" from registry`}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <footer className="landing__footer">
        <a
          className="landing__footer-link"
          href="https://github.com/glyphs-ai/glyph"
          target="_blank"
          rel="noreferrer noopener"
        >
          <GitHubMark />
          <span>GitHub</span>
        </a>
        <a
          className="landing__footer-link"
          href="https://github.com/glyphs-ai/glyph#readme"
          target="_blank"
          rel="noreferrer noopener"
        >
          Documentation
        </a>
        <span className="landing__footer-version">v0.1.0-alpha</span>
      </footer>

      <AddWorkspaceModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={async () => {
          setAddOpen(false);
          await refresh();
        }}
      />

      <RemoveWorkspaceModal
        target={removeTarget}
        onClose={() => setRemoveTarget(null)}
        onRemoved={async () => {
          setRemoveTarget(null);
          await refresh();
        }}
      />
    </div>
  );
}
