import { useState } from "react";
import type { WorkflowHeaderWire } from "../../api";
import { Modal } from "../Modal";

export interface CancelWorkflowModalProps {
  target: WorkflowHeaderWire;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (reason: string) => void | Promise<void>;
}
/**
 * Confirm modal for the Cancel-workflow action. Mirrors the
 * destructive-confirm shape used by
 * `components/schedules/ScheduleConfirmModals.tsx` (footer with a
 * Cancel + a danger primary button, error banner above the body). The
 * optional reason textarea is forwarded to the server as the
 * `cancellation.message` field (`Workflows.tsx` wraps it in the
 * required `{ cancellation: { kind: 'user', message } }` shape before
 * calling `cancelWorkflow`). Empty message is allowed.
 */
export function CancelWorkflowModal({
  target,
  busy,
  error,
  onClose,
  onConfirm,
}: CancelWorkflowModalProps) {
  const [reason, setReason] = useState("");
  return (
    <Modal open={true} onClose={onClose} title="Cancel workflow" size="default">
      <div className="modal__body">
        {error && (
          <div
            className="alert alert--error"
            style={{ marginBottom: 10 }}
            data-testid="cancel-workflow-error"
          >
            ⚠️ {error}
          </div>
        )}
        <p>
          Cancel workflow <code>{target.id.slice(0, 8)}</code>? Any in-flight coordinator or task
          nodes will stop on the next tick. Already completed nodes are not reverted. This action
          cannot be undone.
        </p>
        <p className="muted" style={{ fontSize: 12, margin: "6px 0 0 0" }}>
          {target.brief}
        </p>
        <label htmlFor="cancel-workflow-reason" style={{ display: "block", marginTop: 12 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
            Reason (optional)
          </div>
          <textarea
            id="cancel-workflow-reason"
            className="input"
            style={{ width: "100%", fontFamily: "inherit", resize: "vertical" }}
            rows={3}
            value={reason}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Superseded by a follow-up workflow"
            data-testid="cancel-workflow-reason"
          />
        </label>
      </div>
      <div className="modal__footer">
        <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
          Keep running
        </button>
        <button
          type="button"
          className="btn btn--danger"
          onClick={() => void onConfirm(reason.trim())}
          disabled={busy}
          data-testid="cancel-workflow-confirm"
        >
          {busy ? "Cancelling…" : "Cancel workflow"}
        </button>
      </div>
    </Modal>
  );
}

export interface DeleteWorkflowModalProps {
  target: WorkflowHeaderWire;
  purge: boolean;
  onPurgeChange: (v: boolean) => void;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}

/**
 * Confirm modal for the Delete-workflow action. Mirrors the Tasks
 * `DeleteTaskModal` shape (default = archive metadata only, optional
 * `purge` checkbox removes on-disk files too) so the two surfaces
 * read identically.
 *
 * Lifecycle constraint enforcement is server-side: a running
 * workflow yields a 409 `WorkflowDeleteRequiresTerminalError`. The
 * page surfaces that as the modal `error` so the user sees the
 * "Cancel first" hint without leaving the dialog.
 */
export function DeleteWorkflowModal({
  target,
  purge,
  onPurgeChange,
  busy,
  error,
  onClose,
  onConfirm,
}: DeleteWorkflowModalProps) {
  return (
    <Modal open={true} onClose={onClose} title="Delete workflow" size="default">
      <div className="modal__body">
        {error && (
          <div
            className="alert alert--error"
            style={{ marginBottom: 10 }}
            data-testid="delete-workflow-error"
          >
            ⚠️ {error}
          </div>
        )}
        <p>
          Delete workflow <code>{target.id.slice(0, 8)}</code>?
        </p>
        <p className="muted" style={{ fontSize: 12, margin: "6px 0 0 0" }}>
          {target.brief}
        </p>
        <p className="muted" style={{ fontSize: 12, margin: "10px 0 0 0" }}>
          By default, the substrate metadata (workflow, nodes, edges) goes; the on-disk workflow dir
          and each node's task workdir are preserved so you can still inspect the run.
        </p>
        <label
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            fontSize: 13,
            marginTop: 10,
          }}
        >
          <input
            type="checkbox"
            checked={purge}
            onChange={(e) => onPurgeChange(e.target.checked)}
            disabled={busy}
            data-testid="delete-workflow-purge"
          />
          Also remove files (workflow dir + per-node task workdirs — cannot be undone)
        </label>
      </div>
      <div className="modal__footer">
        <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
          Keep
        </button>
        <button
          type="button"
          className="btn btn--danger"
          onClick={() => void onConfirm()}
          disabled={busy}
          data-testid="delete-workflow-confirm"
        >
          {busy ? "Deleting…" : purge ? "Delete and remove files" : "Delete"}
        </button>
      </div>
    </Modal>
  );
}
