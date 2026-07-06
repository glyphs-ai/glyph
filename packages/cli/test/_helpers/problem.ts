/**
 * Build an RFC 9457 `application/problem+json` response body for CLI
 * command tests, mirroring the server's envelope construction
 * (`packages/api/src/schemas/problem.ts`): `type` is the kebab-cased code
 * under the canonical prefix, `title` is the humanized code, and the five
 * core members (`type` / `title` / `status` / `detail` / `code`) are
 * always present. Extension members (`fromStatus`, `transition`, `agent`,
 * `reason`, …) ride in `extra`.
 *
 * The server always emits the full Problem envelope, so these mocks must
 * too: the CLI narrows the decoded body with `isProblem` before reading
 * `code` / `detail`, and a partial `{ error, code }` shape would (rightly)
 * fail that guard and surface a bare `HTTP <status>` instead of the typed
 * code.
 */

const PROBLEM_TYPE_PREFIX = "https://errors.glyph.ai/";

function kebabCase(code: string): string {
  return code
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

function humanizeCode(code: string): string {
  const stem = code.endsWith("Error") ? code.slice(0, -5) : code;
  const spaced = stem
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  if (spaced === "") return "Error";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function problemBody(
  status: number,
  code: string,
  detail: string,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    type: `${PROBLEM_TYPE_PREFIX}${kebabCase(code)}`,
    title: humanizeCode(code),
    status,
    detail,
    code,
    ...extra,
  });
}
