/**
 * Display-only truncation for user-authored brief strings.
 *
 * Briefs (workflow.brief, task.brief, worker-node spec.brief) are
 * single-line strings capped at 200 chars by the contract layer, but
 * 200 chars is still wide enough to blow out narrow list-row columns
 * and graph-node card titles when rendered as a one-liner. This helper
 * caps the displayed string to `maxChars` (default 80) and appends a
 * single-character ellipsis ("…") when the cap fires.
 *
 * Word-boundary trim: when there is whitespace inside the last
 * quarter of the visible window, the cut is rolled back to that
 * whitespace so the truncation lands on a word boundary rather than
 * mid-word. Falls back to a hard char-count cut when no whitespace
 * sits in that tail window.
 *
 * This is presentation-only. Callers MUST also preserve the full,
 * untruncated brief in a sibling `title` attribute (or equivalent
 * accessible-name surface) so screen-reader users and mouse hovers
 * still see the complete text. The helper does not modify or surface
 * the original string in any way other than the returned display
 * string.
 */
export function truncateBrief(text: string, maxChars = 80): string {
  if (typeof text !== "string") return "";
  if (maxChars <= 0) return "";
  if (text.length <= maxChars) return text;

  const ELLIPSIS = "…";
  // Reserve one character for the ellipsis so the visible glyph count
  // never exceeds the requested cap. With maxChars=1 the only thing
  // we can show is the ellipsis itself.
  const budget = maxChars - 1;
  if (budget <= 0) return ELLIPSIS;

  const hardCut = text.slice(0, budget);
  // Look for the last whitespace in the trailing quarter of the
  // budget; rolling back further than 25% reads as "lots of missing
  // text" rather than "ended one word early", which the hard cut
  // already conveys. The quarter window also gives single long words
  // (e.g. URLs) a graceful fallback to the hard cut.
  const tailWindow = Math.max(1, Math.floor(budget / 4));
  const windowStart = budget - tailWindow;
  const lastWs = hardCut.slice(windowStart).search(/\s\S*$/);
  if (lastWs >= 0) {
    const absolute = windowStart + lastWs;
    return `${hardCut.slice(0, absolute).trimEnd()}${ELLIPSIS}`;
  }
  return `${hardCut.trimEnd()}${ELLIPSIS}`;
}
