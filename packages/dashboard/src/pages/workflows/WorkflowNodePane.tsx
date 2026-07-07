import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { findTaskByOrigin, type WorkflowDag, type WorkflowHeader } from "../../api";
import { TaskView } from "../../components/task-view";
import { useTaskDetail } from "../../hooks/useTaskDetail";
import { orderNodesForNav } from "./workflow-nav-utils.js";

export interface WorkflowNodePaneProps {
  /** The parent workflow header (used for the back-label only). */
  workflow: WorkflowHeader;
  /** The current DAG (used for the prev/next walk). */
  dag: WorkflowDag | null;
  /** The node id requested via `?nodeId=`. May be stale (URL-shareable). */
  nodeId: string;
  /** Polling cadence for the task header + activity stream. */
  pollIntervalMs: number;
  /** Called when the user clicks ← Back; parent clears `?nodeId=`. */
  onBack: () => void;
  /** Called when the user clicks ‹ / ›; parent atomically sets `?nodeId=`. */
  onNavigate: (nextNodeId: string) => void;
}

/**
 * Workflows-page Mode B (right pane) — full TaskView for a single
 * workflow node's underlying task. Mirrors the structural shape of
 * {@link FireTaskDetailPane}:
 *
 *   - The pane owns its own node-list walk (sourced from the parent's
 *     already-fetched `dag.nodes`); navigation never re-fetches.
 *   - When `nodeId` resolves to a node in the current dag, the
 *     full `TaskView` is mounted with a header-trailing pill carrying
 *     `← Back to "{brief}"` + `‹ N/M ›`. The N/M counter is keyed off
 *     **node order** (phase ASC, createdAt ASC), so a user walking
 *     `‹` from the start of the workflow sees the next earlier node
 *     in execution order.
 *   - When `nodeId` is not in the current dag (URL shared from
 *     another workflow, or a node was pruned), a "Node not found"
 *     fallback with a back-only row is shown.
 *
 * `useTaskDetail` is mounted via the inner `NodeTaskView` so it can be
 * `key`-remounted on `nodeId` swap — defence-in-depth around the
 * hook's monotonic seq guard.
 */
export function WorkflowNodePane({
  workflow,
  dag,
  nodeId,
  pollIntervalMs,
  onBack,
  onNavigate,
}: WorkflowNodePaneProps) {
  const orderedNodes = useMemo(() => {
    return orderNodesForNav(dag).filter((n) => n.kind !== "human");
  }, [dag]);
  const currentIndex = useMemo(
    () => orderedNodes.findIndex((n) => n.id === nodeId),
    [orderedNodes, nodeId],
  );
  const found = currentIndex !== -1;

  const prevId = found && currentIndex > 0 ? (orderedNodes[currentIndex - 1]?.id ?? null) : null;
  const nextId =
    found && currentIndex < orderedNodes.length - 1
      ? (orderedNodes[currentIndex + 1]?.id ?? null)
      : null;

  if (dag === null) {
    return (
      <aside className="tasks-pane__detail" data-testid="workflow-node-pane">
        <FallbackBackRow workflow={workflow} onBack={onBack} />
        <p className="muted" style={{ padding: 16 }}>
          Loading workflow nodes…
        </p>
      </aside>
    );
  }

  if (!found) {
    return (
      <aside className="tasks-pane__detail" data-testid="workflow-node-not-found">
        <FallbackBackRow workflow={workflow} onBack={onBack} />
        <div className="empty" style={{ padding: 16 }}>
          <p className="empty__title">Node not found</p>
          <p className="empty__hint">
            This task is not part of the current workflow's DAG (the node may have been pruned, or
            the URL belongs to a different workflow).
          </p>
        </div>
      </aside>
    );
  }

  const total = orderedNodes.length;
  const position = currentIndex + 1;
  const currentNode = orderedNodes[currentIndex] ?? null;

  const pill = (
    <WorkflowNodeNav
      workflowBrief={workflow.brief}
      position={position}
      total={total}
      specVersion={currentNode?.specVersion ?? null}
      onBack={onBack}
      onPrev={prevId !== null ? () => onNavigate(prevId) : null}
      onNext={nextId !== null ? () => onNavigate(nextId) : null}
    />
  );

  return (
    <aside className="tasks-pane__detail" data-testid="workflow-node-pane">
      <NodeTaskView
        key={nodeId}
        nodeId={nodeId}
        pollIntervalMs={pollIntervalMs}
        headerTrailing={pill}
      />
    </aside>
  );
}

interface FallbackBackRowProps {
  workflow: WorkflowHeader;
  onBack: () => void;
}

/**
 * Minimal back-only row used while the dag is loading or the
 * requested `nodeId` isn't part of the current workflow. The
 * success path uses {@link WorkflowNodeNav} inside the TaskView
 * title row instead, costing zero extra vertical space.
 */
function FallbackBackRow({ workflow, onBack }: FallbackBackRowProps) {
  return (
    <nav
      className="workflow-node-nav workflow-node-nav--fallback"
      aria-label="Workflow node navigation"
      data-testid="workflow-node-nav"
    >
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={onBack}
        data-testid="workflow-node-back"
        title={`Back to ${workflow.brief}`}
      >
        ← Back to workflow
      </button>
    </nav>
  );
}

interface WorkflowNodeNavProps {
  workflowBrief: string;
  position: number;
  total: number;
  specVersion: number | null;
  onBack: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
}

/**
 * Compact navigation pill rendered in the TaskView title row's trailing
 * slot. Shape: `[← workflow] · [‹ N/M ›]`. Mirrors {@link FireNavPill}
 * structurally so the dashboard's master/detail panes share a
 * recognisable shape.
 *
 * `aria-label="position N of total M"` matches the `FireNavPill`
 * choice — no `aria-live` so the count change as the DAG grows in the
 * background doesn't trigger noisy announcements.
 */
function WorkflowNodeNav({
  workflowBrief,
  position,
  total,
  specVersion,
  onBack,
  onPrev,
  onNext,
}: WorkflowNodeNavProps) {
  return (
    <nav
      className="workflow-node-nav"
      aria-label="Workflow node navigation"
      data-testid="workflow-node-nav"
    >
      <button
        type="button"
        className="workflow-node-nav__back"
        onClick={onBack}
        data-testid="workflow-node-back"
        title={`Back to ${workflowBrief}`}
      >
        <span aria-hidden="true">← </span>
        <span className="workflow-node-nav__back-label">workflow</span>
      </button>
      <span className="workflow-node-nav__sep" aria-hidden="true" />
      <button
        type="button"
        className="workflow-node-nav__step"
        onClick={onPrev ?? undefined}
        disabled={onPrev === null}
        data-testid="workflow-node-prev"
        aria-label={`Previous node (currently ${position} of ${total})`}
        title="Previous node"
      >
        ‹
      </button>
      <span className="workflow-node-nav__pos" data-testid="workflow-node-position">
        {position} / {total}
      </span>
      <button
        type="button"
        className="workflow-node-nav__step"
        onClick={onNext ?? undefined}
        disabled={onNext === null}
        data-testid="workflow-node-next"
        aria-label={`Next node (currently ${position} of ${total})`}
        title="Next node"
      >
        ›
      </button>
      {specVersion !== null ? (
        <span
          className="workflow-node-spec-version"
          data-testid="workflow-node-spec-version"
          title="Spec version (optimistic-concurrency token for updateNodeSpec)"
        >
          spec v{specVersion}
        </span>
      ) : null}
    </nav>
  );
}

interface NodeTaskViewProps {
  nodeId: string;
  pollIntervalMs: number;
  headerTrailing?: ReactNode;
}

/**
 * Inner remount-keyed view that resolves a workflow worker node to its
 * latest underlying task, then owns the `useTaskDetail` hook for that task.
 *
 * A workflow node id is NOT a task id: the coordinator spawns a task per
 * worker node (retries spawn fresh tasks), and the `(origin: "workflow",
 * originId: nodeId)` linkage is owned by the task read-model. We resolve the
 * node id to its latest task via {@link findTaskByOrigin}, then feed the real
 * task id to `useTaskDetail`. Same remount-keyed pattern as `FireTaskView`.
 */
function NodeTaskView({ nodeId, pollIntervalMs, headerTrailing }: NodeTaskViewProps) {
  const [resolvedTaskId, setResolvedTaskId] = useState<string | null>(null);
  const [resolving, setResolving] = useState(true);
  const [resolveError, setResolveError] = useState<string | null>(null);
  // Monotonic request id so a slow resolve from a previous node cannot
  // overwrite the current node's resolution after a fast node switch.
  const seqRef = useRef(0);

  useEffect(() => {
    const seq = ++seqRef.current;
    setResolving(true);
    setResolveError(null);
    setResolvedTaskId(null);
    findTaskByOrigin("workflow", nodeId)
      .then((task) => {
        if (seq !== seqRef.current) return;
        setResolvedTaskId(task?.id ?? null);
        setResolving(false);
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return;
        setResolveError(err instanceof Error ? err.message : String(err));
        setResolving(false);
      });
  }, [nodeId]);

  const { task, activity, activityError, loadOlder } = useTaskDetail(
    resolvedTaskId,
    pollIntervalMs,
  );
  const handleLoadOlder = useCallback(() => loadOlder(), [loadOlder]);

  if (resolving) {
    return (
      <NodeTaskStatus headerTrailing={headerTrailing}>
        <p className="muted" style={{ padding: 16 }}>
          Loading task…
        </p>
      </NodeTaskStatus>
    );
  }

  if (resolveError !== null) {
    return (
      <NodeTaskStatus headerTrailing={headerTrailing}>
        <div className="empty" style={{ padding: 16 }}>
          <p className="empty__title">Couldn't load task</p>
          <p className="empty__hint">{resolveError}</p>
        </div>
      </NodeTaskStatus>
    );
  }

  if (resolvedTaskId === null) {
    return (
      <NodeTaskStatus headerTrailing={headerTrailing}>
        <div className="empty" style={{ padding: 16 }} data-testid="workflow-node-no-task">
          <p className="empty__title">No task yet</p>
          <p className="empty__hint">
            This node hasn't dispatched a task yet — it may still be waiting on its parents.
          </p>
        </div>
      </NodeTaskStatus>
    );
  }

  return (
    <TaskView
      task={task}
      requestedTaskId={resolvedTaskId}
      activity={activity}
      activityError={activityError}
      onLoadOlder={handleLoadOlder}
      headerTrailing={headerTrailing}
    />
  );
}

/**
 * Wrapper that keeps the node-navigation pill (`headerTrailing`) visible
 * while the node's task is still resolving, absent, or errored — the pill
 * is inter-node navigation and must not disappear just because the current
 * node's task hasn't loaded.
 */
function NodeTaskStatus({
  headerTrailing,
  children,
}: {
  headerTrailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      {headerTrailing !== undefined ? (
        <div className="tasks-pane__detail-headerbar">{headerTrailing}</div>
      ) : null}
      {children}
    </div>
  );
}
