import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkflowArtifactWire, WorkflowDagWire, WorkflowHeaderWire } from "../../api";
import { workflowArtifactUrl } from "../../api";
import { ArtifactViewer } from "../../components/viewers/ArtifactViewer";
import { viewerNeedsBlob } from "../../components/viewers/index";
import { formatPhaseLabel } from "./dag-edge-geometry";

export interface ArtifactsTabProps {
  workflow: WorkflowHeaderWire;
  dag: WorkflowDagWire | null;
  /**
   * Flattened workflow artifact list owned by the parent (the
   * `useWorkflowArtifacts` hook is lifted into {@link WorkflowView} so
   * the tab label can render an `Artifacts (N)` count badge without
   * the tab having to mount first). `null` while the initial fetch is
   * still in flight; an empty array means "loaded, none surfaced".
   */
  artifacts: readonly WorkflowArtifactWire[] | null;
  /** Mirrors `useWorkflowArtifacts().loaded`. */
  loaded: boolean;
  /** Mirrors `useWorkflowArtifacts().error`; non-null swaps to a banner. */
  error: string | null;
}

/**
 * One entry rendered in the dropdown — flattened representation of a
 * workflow artifact ready for `<select>` consumption.
 *
 *   - `value`   — unique key per artifact, used as the `<option>` value.
 *     We embed the sentinel sub-path so the lookup back to a wire
 *     `WorkflowArtifactWire` is just a Map hit.
 *   - `label`   — what the operator sees in the dropdown (filename).
 *   - `group`   — `<optgroup label>`: "Workflow" or the per-node label.
 *   - `subPath` — sentinel-prefixed path passed to the server's
 *     `/artifacts/nodes/*` or `/artifacts/summary/*` byte route.
 *   - `nodeId`  — `null` for summary artifacts, the originating
 *     node ID otherwise (used for stable group ordering).
 */
interface Entry {
  value: string;
  label: string;
  group: string;
  subPath: string;
  nodeId: string | null;
}

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; content: string | Blob; size: number }
  | { status: "error"; message: string };

/**
 * Compose the sentinel sub-path the server's static-bytes route
 * expects. The wire shape's `path` is relative to the underlying
 * artifact root only — the sentinel prefix (`summary/` or
 * `nodes/<nid>/`) is what tells the server which root to look in.
 */
function artifactSubPath(a: WorkflowArtifactWire): string {
  return a.kind === "workflow-summary" ? `summary/${a.path}` : `nodes/${a.nodeId}/${a.path}`;
}

/**
 * Artifacts tab — workflow-level artifact browser.
 *
 * File-dropdown UX that mirrors `components/tasks/TaskDetail/ArtifactsTab.tsx`.
 * A single `<select>`
 * lists every workflow artifact, grouped via `<optgroup>` by source
 * (workflow summary → per-node), with a `<ArtifactViewer>` preview pane
 * that auto-loads the selected file. This replaces the nested-list
 * card grid that became unscannable once a workflow accumulated >10
 * files.
 *
 * Behaviour notes:
 *   - Selection persists across artifact-list polls so long as the
 *     selected key still resolves; if a transient artifact disappears
 *     (e.g. coord rewrote a draft), selection falls back to the first
 *     remaining entry.
 *   - Each new selection aborts the in-flight fetch via
 *     `AbortController`, so rapid keyboard navigation through the
 *     dropdown doesn't race a slow response in.
 *   - The viewer is force-remounted on selection change so internal
 *     state (object URLs, JSON memo) cannot leak across artifacts.
 */
export function ArtifactsTab({ workflow, dag, artifacts, loaded, error }: ArtifactsTabProps) {
  const entries = useMemo(() => flattenEntries(artifacts ?? [], dag), [artifacts, dag]);

  const [selected, setSelected] = useState<string | null>(null);
  const [fetchState, setFetchState] = useState<FetchState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  // Auto-select the first entry whenever the dropdown is non-empty
  // and nothing is selected yet — without this the viewer pane would
  // sit empty on first paint and the operator would have to discover
  // they need to open the dropdown.
  useEffect(() => {
    if (entries.length > 0 && selected === null) {
      const first = entries[0];
      if (first !== undefined) setSelected(first.value);
    }
  }, [entries, selected]);

  // Reset selection if it points at an entry that no longer exists
  // (the artifact set just got re-polled and the previously-selected
  // file is gone). The auto-select-first effect above will then pick
  // the new head.
  useEffect(() => {
    if (selected !== null && !entries.some((e) => e.value === selected)) {
      setSelected(null);
    }
  }, [entries, selected]);

  const selectedEntry = useMemo(
    () => (selected !== null ? entries.find((e) => e.value === selected) : undefined),
    [entries, selected],
  );

  // Stable identity key for the currently-selected artifact's bytes:
  // sub-path + modifiedAt (looked up against the wire artifact list,
  // which IS the source of truth for "this artifact changed"). The
  // bytes-fetch effect below keys on this string, so a poll that
  // returns the same artifact list (or one where the currently-
  // selected artifact's modifiedAt is unchanged) is a no-op for the
  // preview pane — the iframe / HTML viewer does not re-mount, no
  // visible flash.
  //
  // The previous shape keyed on the `selectedEntry` object identity,
  // which gets a fresh reference on every poll cycle because
  // `entries` is recomputed by the `useMemo` above and
  // `entries.find(...)` produces a new entry object each call. That
  // forced a full byte refetch + viewer remount every
  // WORKFLOW_POLL_INTERVAL_MS while the workflow was running.
  const selectedFetchKey = useMemo(() => {
    if (selectedEntry === undefined) return null;
    const modifiedAt = lookupModifiedAt(artifacts, selectedEntry);
    return `${selectedEntry.subPath}|${modifiedAt ?? ""}`;
  }, [selectedEntry, artifacts]);

  // Read the currently-selected entry through a ref so the bytes-fetch
  // effect below can resolve `subPath` / `label` without listing
  // `selectedEntry` in its dep array. `selectedEntry`'s object identity
  // changes on every artifacts poll; listing it would re-fire the
  // effect for unchanged bytes — `selectedFetchKey` is the stable key
  // that captures the only conditions that should trigger a refetch.
  const selectedEntryRef = useRef<Entry | undefined>(selectedEntry);
  selectedEntryRef.current = selectedEntry;

  // Fetch the selected artifact's bytes, aborting any in-flight
  // request when the selection key (sub-path + modifiedAt) or the
  // workflow id changes.
  useEffect(() => {
    const entry = selectedEntryRef.current;
    if (entry === undefined || selectedFetchKey === null) {
      setFetchState({ status: "idle" });
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setFetchState({ status: "loading" });

    const url = workflowArtifactUrl(workflow.id, entry.subPath);
    const asBlob = viewerNeedsBlob(entry.label);
    (async () => {
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) {
          setFetchState({
            status: "error",
            message: `Failed to load artifact (${res.status})`,
          });
          return;
        }
        if (asBlob) {
          const blob = await res.blob();
          setFetchState({ status: "loaded", content: blob, size: blob.size });
        } else {
          const text = await res.text();
          setFetchState({ status: "loaded", content: text, size: text.length });
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setFetchState({
          status: "error",
          message: err instanceof Error ? err.message : "Failed to load artifact",
        });
      }
    })();

    return () => ctrl.abort();
  }, [selectedFetchKey, workflow.id]);

  const handleSelect = useCallback((value: string) => {
    setSelected(value);
  }, []);

  if (error !== null) {
    return (
      <div className="artifacts-pane" data-testid="workflow-artifacts-tab">
        <div className="alert alert--error" data-testid="workflow-artifacts-error">
          ⚠️ {error}
        </div>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="artifacts-pane" data-testid="workflow-artifacts-tab">
        <div className="empty" data-testid="workflow-artifacts-loading">
          <p className="empty__title">Loading artifacts…</p>
        </div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="artifacts-pane" data-testid="workflow-artifacts-tab">
        <div className="empty" data-testid="workflow-artifacts-empty">
          <div className="empty__icon" aria-hidden="true">
            📂
          </div>
          <p className="empty__title">No artifacts</p>
          <p className="empty__hint">
            Neither the coordinator nor any task has emitted a workflow artifact yet.
          </p>
        </div>
      </div>
    );
  }

  const grouped = groupEntries(entries);
  const downloadUrl = selectedEntry
    ? workflowArtifactUrl(workflow.id, selectedEntry.subPath)
    : undefined;

  return (
    <div className="artifacts-pane" data-testid="workflow-artifacts-tab">
      <header className="artifacts-pane__header">
        <label className="artifacts-pane__selector-label">
          <span className="visually-hidden">Artifact</span>
          <select
            className="artifacts-pane__selector"
            value={selected ?? ""}
            onChange={(e) => handleSelect(e.target.value)}
            aria-label="Select workflow artifact"
            data-testid="workflow-artifacts-selector"
          >
            {grouped.map((g) => (
              <optgroup key={g.group} label={g.group}>
                {g.entries.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <a
          href={downloadUrl ?? "#"}
          className={`artifacts-pane__download${selectedEntry ? "" : " artifacts-pane__download--disabled"}`}
          target="_blank"
          rel="noreferrer noopener"
          download={selectedEntry?.label}
          aria-disabled={selectedEntry ? undefined : true}
          tabIndex={selectedEntry ? undefined : -1}
          title={selectedEntry ? `Download ${selectedEntry.label}` : "No artifact selected"}
        >
          Download
        </a>
      </header>
      <div className="artifacts-pane__preview" data-testid="workflow-artifacts-preview">
        <ArtifactPreview
          selected={selectedEntry ?? null}
          state={fetchState}
          downloadUrl={downloadUrl}
        />
      </div>
    </div>
  );
}

interface ArtifactPreviewProps {
  selected: Entry | null;
  state: FetchState;
  downloadUrl: string | undefined;
}

function ArtifactPreview({ selected, state, downloadUrl }: ArtifactPreviewProps) {
  if (selected === null) {
    return <div className="artifact-viewer artifact-viewer--empty">Loading…</div>;
  }
  if (state.status === "loading") {
    return (
      <div className="artifact-viewer artifact-viewer--empty">
        <span className="artifact-viewer__spinner" aria-hidden="true" />
        Loading…
      </div>
    );
  }
  if (state.status === "error") {
    return <div className="artifact-viewer artifact-viewer--error">{state.message}</div>;
  }
  if (state.status === "loaded") {
    return (
      <ArtifactViewer
        key={selected.value}
        filename={selected.label}
        content={state.content}
        size={state.size}
        downloadUrl={downloadUrl}
      />
    );
  }
  return null;
}

/**
 * Flatten the artifact wire list into a stable dropdown order:
 * Summary entries first, then per-node sections in DAG order
 * (phase ascending, createdAt ascending), then unknown nodes
 * appended at the end. Inside each section files are sorted by path.
 *
 * Per-node group labels read as `${agent} · ${formatPhaseLabel(phase)}`
 * (e.g. `official/reviewer · Phase 2`). When multiple nodes share the
 * same `(agent, phase)` bucket — e.g. two parallel reviewers spawned
 * by the same coord wake-up — a `· #N` 1-indexed disambiguator is
 * appended, ordered by `createdAt` ASC (same convention
 * `dag-edge-geometry.ts:groupByPhase` uses for sibling column order).
 * Single-node buckets stay clean as `agent · Phase N`.
 */
function flattenEntries(
  artifacts: readonly WorkflowArtifactWire[],
  dag: WorkflowDagWire | null,
): Entry[] {
  const summary: WorkflowArtifactWire[] = [];
  const byNode = new Map<string, WorkflowArtifactWire[]>();
  for (const a of artifacts) {
    if (a.kind === "workflow-summary") {
      summary.push(a);
      continue;
    }
    const existing = byNode.get(a.nodeId);
    if (existing !== undefined) {
      existing.push(a);
    } else {
      byNode.set(a.nodeId, [a]);
    }
  }

  // Pre-compute the `(agent, phase) → ordered nodeIds` bucket map so
  // each per-entry label resolves in O(1) without re-walking the DAG.
  // Order within a bucket is `createdAt` ASC to match groupByPhase.
  const bucketIndex = buildNodeBucketIndex(dag);

  const out: Entry[] = [];
  for (const a of sortArtifacts(summary)) {
    out.push({
      value: artifactSubPath(a),
      label: filenameOf(a.path),
      group: "Workflow",
      subPath: artifactSubPath(a),
      nodeId: null,
    });
  }

  const nodeOrder = dagNodeOrder(dag);
  const seen = new Set<string>();
  for (const nodeId of nodeOrder) {
    const list = byNode.get(nodeId);
    if (list === undefined) continue;
    seen.add(nodeId);
    const label = nodeGroupLabel(nodeId, dag, bucketIndex);
    for (const a of sortArtifacts(list)) {
      out.push({
        value: artifactSubPath(a),
        label: filenameOf(a.path),
        group: label,
        subPath: artifactSubPath(a),
        nodeId,
      });
    }
  }
  for (const [nodeId, list] of byNode.entries()) {
    if (seen.has(nodeId)) continue;
    const label = nodeGroupLabel(nodeId, dag, bucketIndex);
    for (const a of sortArtifacts(list)) {
      out.push({
        value: artifactSubPath(a),
        label: filenameOf(a.path),
        group: label,
        subPath: artifactSubPath(a),
        nodeId,
      });
    }
  }
  return out;
}

/**
 * Bucket the flat entry list by `group` while preserving the order
 * established in {@link flattenEntries}. Returns one bucket per
 * `<optgroup>` to render.
 */
function groupEntries(entries: readonly Entry[]): { group: string; entries: Entry[] }[] {
  const out: { group: string; entries: Entry[] }[] = [];
  let current: { group: string; entries: Entry[] } | null = null;
  for (const entry of entries) {
    if (current === null || current.group !== entry.group) {
      current = { group: entry.group, entries: [] };
      out.push(current);
    }
    current.entries.push(entry);
  }
  return out;
}

/**
 * Per-`(agent, phase)` ordered list of node ids, sorted by
 * `createdAt` ASC — drives the `· #N` disambiguator appended to
 * dropdown group labels when multiple nodes share the same bucket.
 * Returns an empty map when `dag` is null so callers can blindly
 * `.get()` without a null guard.
 */
function buildNodeBucketIndex(dag: WorkflowDagWire | null): ReadonlyMap<string, readonly string[]> {
  const out = new Map<string, string[]>();
  if (dag === null) return out;
  const ordered = [...dag.nodes].sort((a, b) => {
    if (a.phase !== b.phase) return a.phase - b.phase;
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });
  for (const node of ordered) {
    const spec = node.spec;
    if (
      (spec.kind !== "coordinator" && spec.kind !== "worker") ||
      !("agent" in spec) ||
      typeof spec.agent !== "string"
    ) {
      continue;
    }
    const key = `${spec.agent}|${node.phase}`;
    const bucket = out.get(key);
    if (bucket === undefined) out.set(key, [node.id]);
    else bucket.push(node.id);
  }
  return out;
}

function nodeGroupLabel(
  nodeId: string,
  dag: WorkflowDagWire | null,
  bucketIndex: ReadonlyMap<string, readonly string[]>,
): string {
  // Trim trailing dashes from the short id so labels read cleanly
  // when the 8-char window happens to land on a separator
  // (e.g. `wf-1234-` would otherwise render as `Node wf-1234-`
  // with a dangling dash).
  const short = nodeId.slice(0, 8).replace(/-+$/, "");
  if (dag === null) return `Node ${short}`;
  const node = dag.nodes.find((n) => n.id === nodeId);
  if (node === undefined) return `Node ${short}`;
  const spec = node.spec;
  if (
    (spec.kind === "coordinator" || spec.kind === "worker") &&
    "agent" in spec &&
    typeof spec.agent === "string"
  ) {
    const base = `${spec.agent} · ${formatPhaseLabel(node.phase)}`;
    const bucket = bucketIndex.get(`${spec.agent}|${node.phase}`);
    if (bucket === undefined || bucket.length <= 1) return base;
    const position = bucket.indexOf(nodeId);
    if (position < 0) return base;
    return `${base} · #${position + 1}`;
  }
  return `Node ${short}`;
}

function dagNodeOrder(dag: WorkflowDagWire | null): string[] {
  if (dag === null) return [];
  return [...dag.nodes]
    .sort((a, b) => {
      if (a.phase !== b.phase) return a.phase - b.phase;
      return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
    })
    .map((n) => n.id);
}

function sortArtifacts<T extends WorkflowArtifactWire>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => a.path.localeCompare(b.path));
}

function filenameOf(p: string): string {
  const parts = p.split("/");
  return parts[parts.length - 1] || p;
}

/**
 * Resolve the `modifiedAt` of the wire artifact behind the given
 * {@link Entry}. The selection's `subPath` is sentinel-prefixed
 * (`summary/<path>` or `nodes/<nodeId>/<path>`), so we reverse that
 * encoding when matching back against the original wire list. Returns
 * `null` if the artifact has been removed between polls — the caller
 * uses that as a stable empty token so the fetch effect still
 * re-fires when the artifact reappears with a new modifiedAt.
 */
function lookupModifiedAt(
  artifacts: readonly WorkflowArtifactWire[] | null,
  entry: Entry,
): string | null {
  if (artifacts === null) return null;
  for (const a of artifacts) {
    if (a.kind === "workflow-summary") {
      if (entry.nodeId === null && `summary/${a.path}` === entry.subPath) {
        return a.modifiedAt;
      }
      continue;
    }
    if (entry.nodeId === a.nodeId && `nodes/${a.nodeId}/${a.path}` === entry.subPath) {
      return a.modifiedAt;
    }
  }
  return null;
}
