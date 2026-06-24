import { type FormEvent, useEffect, useState } from "react";
import { addWorkspace, removeWorkspace, type WorkspaceListItem } from "../api";
import { Modal } from "../components/Modal";

interface AddWorkspaceModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}

/**
 * Two-field form: display name (required) + workspace directory
 * (optional). Used in place of two sequential window.prompt() dialogs
 * which gave no chance to revise inputs and looked out of place compared
 * to the rest of the dashboard. When the directory is omitted, the
 * server allocates one under `$GLYPH_HOME/workspaces/<uuid>/` and
 * uses the same UUID as the workspace's registry id, so id and on-disk
 * dir name stay in sync.
 */
export function AddWorkspaceModal({ open, onClose, onCreated }: AddWorkspaceModalProps) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset every time the modal opens so a previous failed attempt
  // doesn't leak its values into the next session.
  useEffect(() => {
    if (open) {
      setName("");
      setPath("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedPath = path.trim();
    if (trimmedName === "") {
      setError("Display name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await addWorkspace({
        name: trimmedName,
        ...(trimmedPath !== "" ? { workspaceDir: trimmedPath } : {}),
      });
      onCreated(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add workspace">
      <form onSubmit={onSubmit}>
        <div className="modal__body">
          <div className="form-field">
            <label htmlFor="add-ws-name">Display name</label>
            <input
              id="add-ws-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme prod"
              // biome-ignore lint/a11y/noAutofocus: opens in response to a user click; auto-focusing the first field is expected UX
              autoFocus
              disabled={busy}
              required
            />
            <p className="form-hint">Free-form text shown in the sidebar and on this page.</p>
          </div>

          <div className="form-field">
            <label htmlFor="add-ws-path">
              Workspace directory <span className="form-label-aside">(optional)</span>
            </label>
            <input
              id="add-ws-path"
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="leave blank for default"
              disabled={busy}
            />
            <p className="form-hint">
              Absolute path on the <strong>server's</strong> filesystem. Leave blank to let glyph
              create one under <code>$GLYPH_HOME/workspaces/&lt;uuid&gt;/</code>.
            </p>
          </div>

          {error && <div className="alert alert--error">⚠ {error}</div>}
        </div>
        <div className="modal__footer">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy || name.trim() === ""}>
            {busy ? "Adding…" : "Add workspace"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface RemoveWorkspaceModalProps {
  target: WorkspaceListItem | null;
  onClose: () => void;
  onRemoved: () => void | Promise<void>;
}

/**
 * Confirmation dialog for DELETE /api/workspaces/:id. The destructive
 * action is intentionally a danger-style button so it stands out, but
 * the message also makes clear that the on-disk workspace files are
 * preserved — only the registry entry goes away.
 */
export function RemoveWorkspaceModal({ target, onClose, onRemoved }: RemoveWorkspaceModalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (target) {
      setBusy(false);
      setError(null);
    }
  }, [target]);

  if (!target) return null;
  const display = target.name ?? target.id;

  const onConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await removeWorkspace(target.id);
      await onRemoved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Modal open={true} onClose={onClose} title="Remove workspace">
      <div className="modal__body">
        <p>
          Remove <code>{display}</code> from glyph?
        </p>
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          Path: <code>{target.workspaceDir}</code>
        </p>
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          The workspace files on disk are kept untouched. Only glyph's metadata (the registry entry
          in <code>global.db</code>) is removed. You can re-add this path later.
        </p>
        {error && <div className="alert alert--error">⚠ {error}</div>}
      </div>
      <div className="modal__footer">
        <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn btn--danger" onClick={onConfirm} disabled={busy}>
          {busy ? "Removing…" : "Remove"}
        </button>
      </div>
    </Modal>
  );
}
