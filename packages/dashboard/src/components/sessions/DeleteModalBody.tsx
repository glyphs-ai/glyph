import type { SessionView } from "../../api";

interface DeleteModalBodyProps {
  session: SessionView;
  purge: boolean;
  busy: boolean;
  onToggle: (v: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteModalBody({
  session,
  purge,
  busy,
  onToggle,
  onCancel,
  onConfirm,
}: DeleteModalBodyProps) {
  const hasRuntimeState = session.runtimeSessionId !== null;
  return (
    <>
      <div className="modal__body">
        <p>
          Delete session <code>{session.id}</code> ({session.agent})?
        </p>
        <p className="muted" style={{ fontSize: 12, margin: "6px 0 0 0" }}>
          By default, the workdir at <code>{session.workdir}</code>
          {hasRuntimeState
            ? ` and the ${session.runtime} runtime state${
                session.runtimeSessionId ? ` (${session.runtimeSessionId.slice(0, 8)}…)` : ""
              }`
            : ""}{" "}
          {hasRuntimeState ? "are" : "is"} preserved on disk so you can recover later.
        </p>
        <label
          style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginTop: 10 }}
        >
          <input
            type="checkbox"
            checked={purge}
            onChange={(e) => onToggle(e.target.checked)}
            disabled={busy}
          />
          Also remove files {hasRuntimeState ? "and runtime state " : ""}(cannot be undone)
        </label>
      </div>
      <div className="modal__footer">
        <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn btn--danger" onClick={onConfirm} disabled={busy}>
          {busy ? "Deleting…" : purge ? "Delete and remove files" : "Delete"}
        </button>
      </div>
    </>
  );
}
