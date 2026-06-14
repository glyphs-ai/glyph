import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { WorkflowDagWire, WorkflowNodeWire } from "../../api";
import { WORKFLOW_NODE_STATUS_LABEL } from "../../components/workflows/shared";
import { truncateBrief } from "../../utils/brief";
import { formatAbsolute, formatDuration, formatRelative } from "../../utils/time";
import {
  buildSlotMap,
  type EdgeEndpoints,
  formatPhaseLabel,
  groupByPhase,
  projectEndpoints,
  type Rect,
  resolveEdges,
} from "./dag-edge-geometry";

/**
 * Per-node card title cap. Wider than the master-list cap (60 isn't
 * enough for a phase + agent + role + iteration prefix) but narrower
 * than the 200-char contract cap so a single SDLC worker brief —
 * composed as `"Iteration N: <role> ... — <workflow.brief verbatim>"`
 * by workflow-coordination §D — can't blow out the phase-column
 * layout. The full brief stays in the chip's `title` attribute and in
 * the Mode B detail pane.
 */
const DAG_BRIEF_CAP = 100;

export interface WorkflowDagViewProps {
  dag: WorkflowDagWire;
  /** Optional node selection (drives the `aria-current="true"` + `.dag-node--selected` styling). */
  selectedNodeId?: string | null;
  /**
   * Called when the user activates (click / Enter / Space) a node.
   * Receives the full wire-shape node so the caller can branch on
   * `taskId` presence without re-looking up the dag map. When the
   * caller is presentational only and doesn't need a click handler,
   * the prop can be omitted — the nodes still render but become
   * non-interactive `<div>`s.
   */
  onSelectNode?: (node: WorkflowNodeWire) => void;
}

/**
 * Vertical (top-to-bottom) DAG view. One row per `phase`, multiple
 * columns per phase for sibling nodes (sorted by
 * `createdAt` ASC within the phase). An SVG overlay draws straight
 * arrows from each parent node's bottom-centre to its child's
 * top-centre, measured at render time via `getBoundingClientRect`.
 *
 * Each node is a `<button>` (when `onSelectNode` is provided) so it
 * is keyboard-reachable, can carry `aria-current`, and triggers
 * navigation on Enter / Space without extra `onKeyDown` plumbing.
 * The visual chip is unchanged across the button / div fork.
 */
export function WorkflowDagView({ dag, selectedNodeId, onSelectNode }: WorkflowDagViewProps) {
  const phases = useMemo(() => groupByPhase(dag.nodes), [dag.nodes]);
  const slotMap = useMemo(() => buildSlotMap(phases), [phases]);
  const segments = useMemo(() => resolveEdges(dag.edges, slotMap), [dag.edges, slotMap]);

  const containerRef = useRef<HTMLElement | null>(null);
  const nodeRefs = useRef<Map<string, HTMLElement>>(new Map());
  const setNodeRef = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el === null) nodeRefs.current.delete(id);
      else nodeRefs.current.set(id, el);
    },
    [],
  );

  const [endpoints, setEndpoints] = useState<readonly EdgeEndpoints[]>([]);
  const [overlay, setOverlay] = useState<{ width: number; height: number } | null>(null);

  const recompute = useCallback(() => {
    const container = containerRef.current;
    if (container === null) return;
    const containerRect = container.getBoundingClientRect();
    const rects = new Map<string, Rect>();
    for (const [id, el] of nodeRefs.current.entries()) {
      const r = el.getBoundingClientRect();
      rects.set(id, {
        left: r.left - containerRect.left,
        top: r.top - containerRect.top,
        width: r.width,
        height: r.height,
      });
    }
    setOverlay({ width: containerRect.width, height: containerRect.height });
    setEndpoints(projectEndpoints(segments, rects));
  }, [segments]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `dag.nodes.length`/`dag.edges.length` are intentional re-render triggers — `recompute` reads node refs and the segments memo, neither of which closes over the dag length, so adding them as deps forces a remeasure after the DAG grows.
  useLayoutEffect(() => {
    recompute();
  }, [recompute, dag.nodes.length, dag.edges.length]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `dag.nodes.length` triggers re-observation of newly-added node refs; otherwise the ResizeObserver only watches the set of refs captured at first mount.
  useEffect(() => {
    if (containerRef.current === null) return;
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", recompute);
      return () => window.removeEventListener("resize", recompute);
    }
    const obs = new ResizeObserver(() => recompute());
    obs.observe(containerRef.current);
    for (const el of nodeRefs.current.values()) {
      obs.observe(el);
    }
    return () => obs.disconnect();
  }, [recompute, dag.nodes.length]);

  if (dag.nodes.length === 0) {
    return (
      <div className="workflow-dag workflow-dag--empty" data-testid="workflow-dag-empty">
        <div className="empty">
          <div className="empty__icon" aria-hidden="true">
            🪄
          </div>
          <p className="empty__title">No nodes yet</p>
          <p className="empty__hint">
            The coordinator has not proposed any task or follow-up nodes for this workflow.
          </p>
        </div>
      </div>
    );
  }

  return (
    <section
      ref={containerRef}
      className="workflow-dag workflow-dag--vertical"
      data-testid="workflow-dag"
      aria-label="Workflow DAG (top-to-bottom by phase)"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: `.workflow-dag` sets `overflow: auto`; axe-core's `scrollable-region-focusable` rule (Level A, serious) requires the container to be keyboard-focusable so users without a mouse can pan the overflow. The `aria-label` already gives it an accessible name.
      tabIndex={0}
    >
      {overlay !== null ? (
        <svg
          className="workflow-dag__edges"
          width={overlay.width}
          height={overlay.height}
          aria-hidden="true"
        >
          <defs>
            <marker
              id="workflow-dag-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="workflow-dag__arrow-head" />
            </marker>
          </defs>
          {endpoints.map((e) => (
            <line
              key={e.id}
              className="workflow-dag__edge"
              x1={e.x1}
              y1={e.y1}
              x2={e.x2}
              y2={e.y2}
              markerEnd="url(#workflow-dag-arrow)"
            />
          ))}
        </svg>
      ) : null}

      <ul className="workflow-dag__phases">
        {phases.map(({ phase, nodes }) => (
          <li
            key={phase}
            className="workflow-dag__phase"
            aria-label={formatPhaseLabel(phase)}
            data-phase={phase}
            data-testid={`workflow-dag-phase-${phase}`}
          >
            <div className="workflow-dag__phase-label muted" aria-hidden="true">
              {formatPhaseLabel(phase)}
            </div>
            <div className="workflow-dag__phase-row">
              {nodes.map((node) => {
                const kind = nodeKind(node);
                const isSelected = selectedNodeId !== undefined && selectedNodeId === node.id;
                const className = [
                  "dag-node",
                  `dag-node--${kind}`,
                  `dag-node--${node.status}`,
                  isSelected ? "dag-node--selected" : null,
                ]
                  .filter((s) => s !== null)
                  .join(" ");
                const title = JSON.stringify(node.spec, null, 2);
                // Trim trailing dashes from the 8-char short id so the chip
                // never ends on a separator (matches the defense in
                // ArtifactsTab's node group label). UUIDv4 first-8 is pure
                // hex, so this is a no-op today, kept as belt-and-braces.
                const idShort = node.id.slice(0, 8).replace(/-+$/, "");
                const agent = extractAgent(node);
                const brief = extractBrief(node);
                const startedAt = node.runningAt;
                const runtime = startedAt ? formatDuration(startedAt, node.endedAt ?? null) : null;
                const startedTitle = startedAt ? formatAbsolute(startedAt) : null;
                const inner = (
                  <>
                    <span className="dag-node__kind-icon" aria-hidden="true">
                      {kind === "coordinator" ? "🧠" : kind === "human" ? "👤" : "⚙"}
                    </span>
                    <span className="dag-node__id">{idShort}</span>
                    {/*
                      Status comes before agent in the header row so it's the
                      primary glanceable signal — matches the "status first,
                      agent secondary" convention used by `TaskListItem` /
                      Reorder is deliberate: status is more useful at a
                      glance than alphabetical id/agent/status ordering.

                      Label goes through {@link WORKFLOW_NODE_STATUS_LABEL}
                      so the raw `not_started` enum surfaces as "Not started"
                      (uppercased by CSS to "NOT STARTED", space-separated)
                      rather than the underscored lifecycle constant
                      "NOT_STARTED" leaking through.
                    */}
                    <span className={`dag-node__status dag-node__status--${node.status}`}>
                      {WORKFLOW_NODE_STATUS_LABEL[node.status]}
                    </span>
                    <span className="dag-node__agent">{agent}</span>
                    {brief !== null ? (
                      <span
                        className="dag-node__brief"
                        title={brief}
                        data-testid={`dag-brief-${node.id}`}
                      >
                        {truncateBrief(brief, DAG_BRIEF_CAP)}
                      </span>
                    ) : null}
                    {/*
                      Why not `<RelativeTime>` (src/components/common/RelativeTime.tsx):
                      the canonical helper renders one of "running for Y", "ran Y · ended Z",
                      or "created Z" — none match the DAG card's required "started X · {running|ran} Y"
                      shape, and it always renders something (falling back to `createdAt`) whereas
                      the DAG card omits the row entirely for not-started nodes. The two formatting
                      primitives (`formatRelative`, `formatDuration`) ARE reused — both come from
                      `utils/time.ts`, so the relative-time / duration logic itself lives in exactly
                      one place.
                    */}
                    {(startedAt || runtime !== null) && (
                      <span className="dag-node__timing">
                        {startedAt ? (
                          <span
                            className="dag-node__started"
                            title={startedTitle ?? undefined}
                            data-testid={`dag-started-${node.id}`}
                          >
                            started {formatRelative(startedAt)}
                          </span>
                        ) : null}
                        {startedAt && runtime !== null ? (
                          <span className="dag-node__timing-sep" aria-hidden="true">
                            {" · "}
                          </span>
                        ) : null}
                        {runtime !== null ? (
                          <span
                            className="dag-node__runtime"
                            data-testid={`dag-runtime-${node.id}`}
                          >
                            {node.endedAt ? "ran" : "running"} {runtime}
                          </span>
                        ) : null}
                      </span>
                    )}
                  </>
                );
                if (onSelectNode === undefined) {
                  return (
                    <div
                      key={node.id}
                      ref={setNodeRef(node.id)}
                      className={className}
                      data-node-id={node.id}
                      data-testid={`dag-node-${node.id}`}
                      title={title}
                    >
                      {inner}
                    </div>
                  );
                }
                const interactive = node.taskId !== undefined || kind === "human";
                return (
                  <button
                    key={node.id}
                    ref={setNodeRef(node.id)}
                    type="button"
                    className={className}
                    data-node-id={node.id}
                    data-testid={`dag-node-${node.id}`}
                    title={
                      interactive
                        ? kind === "human"
                          ? `Open human node ${idShort}`
                          : `Open task ${node.taskId}`
                        : title
                    }
                    aria-current={isSelected ? "true" : undefined}
                    aria-disabled={interactive ? undefined : true}
                    onClick={() => {
                      if (!interactive) return;
                      onSelectNode(node);
                    }}
                  >
                    {inner}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Best-effort agent extraction from a node spec. Coordinator and worker
 * specs both carry an `agent` field; human nodes use a static label;
 * unknown spec kinds fall back to "—" so the row still renders a
 * placeholder rather than an empty span (visual stability).
 */
function extractAgent(node: WorkflowNodeWire): string {
  const spec = node.spec;
  if (spec.kind === "human") return "Human gate";
  if (
    (spec.kind === "coordinator" || spec.kind === "worker") &&
    "agent" in spec &&
    typeof spec.agent === "string"
  ) {
    return spec.agent;
  }
  return "—";
}

/**
 * Worker/human brief extraction. Worker nodes carry a user-authored single
 * line in `spec.brief` that names what the task is doing; human nodes
 * carry `spec.prompt` (the question being asked); coordinator nodes have
 * no brief (they are auto-spawned by the substrate and their identity is
 * already named by the agent FQN), so this returns `null` for them.
 * Returning null lets the caller skip rendering the brief row entirely
 * rather than reserving empty vertical space.
 */
function extractBrief(node: WorkflowNodeWire): string | null {
  const spec = node.spec;
  if (spec.kind === "worker" && "brief" in spec && typeof spec.brief === "string") {
    return spec.brief;
  }
  if (spec.kind === "human" && "prompt" in spec && typeof spec.prompt === "string") {
    return spec.prompt;
  }
  return null;
}

/**
 * Project the node spec's discriminator down to the dashboard's
 * styling vocabulary. The contracts wire shape carries kind ONLY on
 * `spec.kind` (the substrate's opaque envelope is flattened by the
 * server-side projection); unknown kinds fall back to
 * `"worker"` so the visual still renders a recognisable node.
 */
function nodeKind(node: WorkflowNodeWire): "coordinator" | "worker" | "human" {
  if (node.spec.kind === "coordinator") return "coordinator";
  if (node.spec.kind === "human") return "human";
  return "worker";
}
