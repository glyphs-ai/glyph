export type WorkflowDrillTarget =
  | { kind: "node"; nodeId: string }
  | { kind: "human"; humanNodeId: string }
  | null;

/**
 * Workflows-only drill-pane priority router. The two URL slots are
 * mutually exclusive in practice (the URL writer never sets both at
 * once); if both are somehow populated, `node` takes precedence.
 *
 * This is a data table, not a state machine: it returns the active
 * drill discriminant for the renderer to switch on. It does NOT
 * encapsulate any rendering decisions.
 */
export function pickDrillTarget(
  nodeId: string | null,
  humanNodeId: string | null,
): WorkflowDrillTarget {
  if (nodeId !== null) return { kind: "node", nodeId };
  if (humanNodeId !== null) return { kind: "human", humanNodeId };
  return null;
}
