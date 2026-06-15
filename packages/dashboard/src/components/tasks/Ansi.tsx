import Anser, { type AnserJsonEntry } from "anser";
import type { CSSProperties, ReactElement } from "react";

export interface AnsiProps {
  /** Text to render. ANSI SGR escape sequences are parsed into colored spans. */
  children: string | undefined | null;
  /** Optional className applied to the wrapping `<code>`. */
  className?: string;
}

/**
 * Render a string containing ANSI escape sequences as colored React spans.
 *
 * Built directly on `anser` (the underlying SGR parser) so the wrapper is
 * compatible with React 19 + Vite ESM bundling — third-party React
 * wrappers around the same parser ship CJS default exports that resolve
 * to an object (not a function) under Vite's ESM interop and crash at
 * render time.
 */
export function Ansi({ children, className }: AnsiProps): ReactElement {
  const text = children ?? "";
  const tokens = Anser.ansiToJson(text, { use_classes: false, remove_empty: true });
  return (
    <code className={className}>
      {tokens.map((token, index) => (
        // Token index is a stable key within a single render: the full token
        // list is re-derived from `children` on every render, so React's
        // reconciler only ever compares siblings produced in the same pass.
        // biome-ignore lint/suspicious/noArrayIndexKey: see comment above
        <span key={index} style={styleFromToken(token)}>
          {token.content}
        </span>
      ))}
    </code>
  );
}

function styleFromToken(token: AnserJsonEntry): CSSProperties {
  const style: CSSProperties = {};
  if (token.fg) style.color = `rgb(${token.fg})`;
  if (token.bg) style.backgroundColor = `rgb(${token.bg})`;
  switch (token.decoration) {
    case "bold":
      style.fontWeight = "bold";
      break;
    case "dim":
      style.opacity = 0.5;
      break;
    case "italic":
      style.fontStyle = "italic";
      break;
    case "underline":
      style.textDecoration = "underline";
      break;
    case "strikethrough":
      style.textDecoration = "line-through";
      break;
    case "hidden":
      style.visibility = "hidden";
      break;
    // `blink` and `reverse` intentionally omitted: blink is accessibility-
    // hostile and browsers no longer animate it; reverse needs paired
    // fg/bg swap that anser already encodes in its color fields.
  }
  return style;
}
