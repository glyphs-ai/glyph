import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { CheckIcon, CopyIcon } from "../Icons";

/**
 * Tiny clipboard button shared across the dashboard. Renders an icon-
 * only affordance (copy glyph that swaps to a check on success) with an
 * adjacent visually-hidden live region so assistive tech announces the
 * "Copied" state -- the button's own accessible name stays static, so
 * `aria-live` on the button itself would announce nothing.
 *
 * The clipboard write, secure-context guard, and self-clearing state
 * live in {@link useCopyToClipboard}; this component owns only the
 * presentation. Icons are SVGs (`CopyIcon` / `CheckIcon`) rather than
 * text glyphs, which did not render consistently across fonts/platforms
 * (wrong glyph, missing, or too wide).
 */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <span className="task-details__copy-wrap">
      <button
        type="button"
        className="btn btn--ghost btn--icon task-details__copy"
        onClick={() => copy(text)}
        aria-label={label}
        title={copied ? "Copied" : label}
      >
        {copied ? (
          <CheckIcon className="task-details__copy-icon" />
        ) : (
          <CopyIcon className="task-details__copy-icon" />
        )}
      </button>
      <span className="visually-hidden" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
    </span>
  );
}
