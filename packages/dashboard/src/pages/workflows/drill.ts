export type WorkflowDrillTarget =
  | { kind: "nodeTask"; nodeTaskId: string }
  | { kind: "human"; humanNodeId: string }
  | null;

/**
 * Workflows-only drill-pane priority router. The two URL slots are
 * mutually exclusive in practice (the URL writer never sets both at
 * once); if both are somehow populated, `nodeTask` takes precedence.
 *
 * This is a data table, not a state machine: it returns the active
 * drill discriminant for the renderer to switch on. It does NOT
 * encapsulate any rendering decisions.
 */
export function pickDrillTarget(
  nodeTaskId: string | null,
  humanNodeId: string | null,
): WorkflowDrillTarget {
  if (nodeTaskId !== null) return { kind: "nodeTask", nodeTaskId };
  if (humanNodeId !== null) return { kind: "human", humanNodeId };
  return null;
}
