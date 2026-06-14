import { useCallback, useMemo, useState } from "react";
import type {
  RespondHumanNodeBody,
  WorkflowDagWire,
  WorkflowHeaderWire,
  WorkflowHumanNodeSpecWire,
  WorkflowNodeWire,
} from "../../api";
import { respondHumanNode } from "../../api/workflows.js";
import { WORKFLOW_NODE_STATUS_LABEL } from "../../components/workflows/shared";
import { orderNodesForNav } from "./workflow-nav-utils.js";

export interface WorkflowNodeHumanPaneProps {
  workflow: WorkflowHeaderWire;
  dag: WorkflowDagWire | null;
  nodeId: string;
  onBack: () => void;
  onNavigate: (nextNodeId: string) => void;
}

/**
 * Mode B right pane for human-kind workflow nodes. Displays the node's
 * prompt and — when the node is `running` — interactive choice cards
 * and a freeform textarea for the operator to respond.
 */
export function WorkflowNodeHumanPane({
  workflow,
  dag,
  nodeId,
  onBack,
  onNavigate,
}: WorkflowNodeHumanPaneProps) {
  const orderedNodes = useMemo(() => orderNodesForNav(dag), [dag]);
  const currentIndex = useMemo(
    () => orderedNodes.findIndex((n) => n.id === nodeId),
    [orderedNodes, nodeId],
  );
  const found = currentIndex !== -1;

  const prevNode = found && currentIndex > 0 ? (orderedNodes[currentIndex - 1] ?? null) : null;
  const nextNode =
    found && currentIndex < orderedNodes.length - 1
      ? (orderedNodes[currentIndex + 1] ?? null)
      : null;

  const node = dag?.nodes.find((n) => n.id === nodeId) ?? null;

  if (dag === null) {
    return (
      <aside className="tasks-pane__detail" data-testid="workflow-human-pane">
        <FallbackBackRow workflow={workflow} onBack={onBack} />
        <p className="muted" style={{ padding: 16 }}>
          Loading workflow nodes…
        </p>
      </aside>
    );
  }

  if (!found || node === null) {
    return (
      <aside className="tasks-pane__detail" data-testid="workflow-human-not-found">
        <FallbackBackRow workflow={workflow} onBack={onBack} />
        <div className="empty" style={{ padding: 16 }}>
          <p className="empty__title">Node not found</p>
          <p className="empty__hint">This human node is not part of the current workflow's DAG.</p>
        </div>
      </aside>
    );
  }

  const total = orderedNodes.length;
  const position = currentIndex + 1;
  const idShort = node.id.slice(0, 8).replace(/-+$/, "");

  const handlePrev = prevNode ? () => onNavigate(prevNode.id) : null;
  const handleNext = nextNode ? () => onNavigate(nextNode.id) : null;

  return (
    <aside className="tasks-pane__detail" data-testid="workflow-human-pane">
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
          title={`Back to ${workflow.brief}`}
        >
          <span aria-hidden="true">← </span>
          <span className="workflow-node-nav__back-label">workflow</span>
        </button>
        <span className="workflow-node-nav__sep" aria-hidden="true" />
        <button
          type="button"
          className="workflow-node-nav__step"
          onClick={handlePrev ?? undefined}
          disabled={handlePrev === null}
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
          onClick={handleNext ?? undefined}
          disabled={handleNext === null}
          data-testid="workflow-node-next"
          aria-label={`Next node (currently ${position} of ${total})`}
          title="Next node"
        >
          ›
        </button>
      </nav>

      <div className="human-respond-panel" data-testid="human-respond-panel">
        <header className="human-respond-panel__header">
          <span className="human-respond-panel__node-id">{idShort}</span>
          <span className={`dag-node__status dag-node__status--${node.status}`}>
            {WORKFLOW_NODE_STATUS_LABEL[node.status]}
          </span>
        </header>

        <HumanNodeContent key={node.id} node={node} />
      </div>
    </aside>
  );
}

interface HumanNodeContentProps {
  node: WorkflowNodeWire;
}

function HumanNodeContent({ node }: HumanNodeContentProps) {
  const spec = node.spec as WorkflowHumanNodeSpecWire;
  const choices = spec.choices ?? [];
  const status = node.status;

  if (status === "not_started" || status === "ready") {
    return (
      <div className="human-respond-panel__body" data-testid="human-content-waiting">
        <p className="human-respond-panel__prompt">{spec.prompt}</p>
        {choices.length > 0 && (
          <div className="human-respond-panel__choices">
            {choices.map((c) => (
              <div
                key={c.id}
                className="human-choice-card human-choice-card--disabled"
                aria-disabled="true"
              >
                {c.label}
              </div>
            ))}
          </div>
        )}
        <p className="muted" style={{ marginTop: 12 }}>
          Waiting for upstream nodes to complete
        </p>
      </div>
    );
  }

  if (status === "running") {
    return <HumanRespondForm node={node} spec={spec} choices={choices} />;
  }

  if (status === "succeeded") {
    const response = node.metadata.response as { choiceId?: string; input?: string } | undefined;
    const selectedChoiceId = response?.choiceId;
    const inputText = response?.input;
    return (
      <div className="human-respond-panel__body" data-testid="human-content-succeeded">
        <p className="human-respond-panel__prompt">{spec.prompt}</p>
        {choices.length > 0 && (
          <div className="human-respond-panel__choices">
            {choices.map((c) => (
              <div
                key={c.id}
                className={`human-choice-card${c.id === selectedChoiceId ? " human-choice-card--selected" : ""}`}
                aria-disabled="true"
              >
                {c.label}
              </div>
            ))}
          </div>
        )}
        {inputText && <p className="human-respond-panel__response-text">{inputText}</p>}
      </div>
    );
  }

  // failed / cancelled
  return (
    <div className="human-respond-panel__body" data-testid="human-content-terminal">
      <p className="human-respond-panel__prompt">{spec.prompt}</p>
      <p className="muted" style={{ marginTop: 12 }}>
        Node {status === "failed" ? "failed" : "was cancelled"}
      </p>
    </div>
  );
}

interface HumanRespondFormProps {
  node: WorkflowNodeWire;
  spec: WorkflowHumanNodeSpecWire;
  choices: readonly { readonly id: string; readonly label: string }[];
}

function HumanRespondForm({ node, spec, choices }: HumanRespondFormProps) {
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = !submitting && (selectedChoiceId !== null || input.trim().length > 0);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const body: RespondHumanNodeBody = {
      ...(selectedChoiceId !== null && { choiceId: selectedChoiceId }),
      ...(input.trim().length > 0 && { input: input.trim() }),
    };
    try {
      await respondHumanNode(node.workflowId, node.id, body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }, [canSubmit, selectedChoiceId, input, node.workflowId, node.id]);

  const placeholder =
    selectedChoiceId !== null ? "Additional input (optional)" : "Enter your response";

  return (
    <div className="human-respond-panel__body" data-testid="human-content-running">
      <p className="human-respond-panel__prompt">{spec.prompt}</p>
      {choices.length > 0 && (
        <fieldset className="human-respond-panel__choices" aria-label="Choices">
          {choices.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={c.id === selectedChoiceId}
              className={`human-choice-card${c.id === selectedChoiceId ? " human-choice-card--selected" : ""}`}
              onClick={() => setSelectedChoiceId(c.id === selectedChoiceId ? null : c.id)}
              data-testid={`human-choice-${c.id}`}
            >
              {c.label}
            </button>
          ))}
        </fieldset>
      )}
      <textarea
        className="human-respond-panel__textarea"
        placeholder={placeholder}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        disabled={submitting}
        data-testid="human-respond-input"
      />
      {error && (
        <div className="alert alert--error" style={{ marginTop: 8 }}>
          ⚠️ {error}
        </div>
      )}
      <button
        type="button"
        className="btn btn--primary human-respond-panel__submit"
        disabled={!canSubmit}
        onClick={handleSubmit}
        data-testid="human-respond-submit"
      >
        {submitting ? "Submitting…" : "Submit"}
      </button>
    </div>
  );
}

interface FallbackBackRowProps {
  workflow: WorkflowHeaderWire;
  onBack: () => void;
}

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
