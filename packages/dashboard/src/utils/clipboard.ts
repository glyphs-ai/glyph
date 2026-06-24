/**
 * Write `text` to the system clipboard, best-effort.
 *
 * Guards the async Clipboard API (absent in insecure contexts such as a
 * `file://`-served preview) and swallows write rejections so callers
 * never have to repeat the try/catch. Returns `true` only when the text
 * was actually written; `false` when the API was unavailable or the
 * write was rejected (e.g. a `SecurityError` in a non-secure context).
 *
 * This is the single low-level clipboard primitive for the dashboard.
 * Affordances that also need a transient "Copied" indicator should use
 * the `useCopyToClipboard` hook (which composes this function); call
 * sites that only fire-and-forget (e.g. a "Copy ID" menu item) can call
 * this directly.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
