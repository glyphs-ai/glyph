import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { CopyIcon } from "../Icons";

interface FallbackModalBodyProps {
  display: string;
  reason: string;
  onClose: () => void;
}

export function FallbackModalBody({ display, reason, onClose }: FallbackModalBodyProps) {
  return (
    <>
      <div className="modal__body">
        <div className="muted" style={{ fontSize: 13 }}>
          We couldn't open a terminal automatically ({reason}). Run this command in your shell to
          start the session:
        </div>
        <CopyRow text={display} />
      </div>
      <div className="modal__footer">
        <button type="button" className="btn btn--primary" onClick={onClose}>
          Done
        </button>
      </div>
    </>
  );
}

interface CopyRowProps {
  text: string;
}

function CopyRow({ text }: CopyRowProps) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <div className="copy-row">
      <span className="copy-row__text">{text}</span>
      <button
        type="button"
        className="btn btn--ghost btn--icon copy-row__btn"
        onClick={() => copy(text)}
        title={copied ? "Copied!" : "Copy to clipboard"}
        aria-label="Copy to clipboard"
      >
        <CopyIcon />
      </button>
    </div>
  );
}
