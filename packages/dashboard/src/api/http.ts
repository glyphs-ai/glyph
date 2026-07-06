// Workspace identity + low-level fetch helpers shared by every other
// `api/*` domain module.
//
// All workspace-scoped requests are routed through `/api/workspaces/<id>/...`
// where <id> is the UUID of the active workspace. The active workspace is
// owned by the React Router URL (`/workspaces/:workspaceId/...`), not
// browser storage, so two tabs at different workspaces stay isolated. The route layout calls
// `setActiveWorkspace` on every URL change to keep this module-level slot
// in sync; api helpers below pull from it at call time so callers don't
// have to thread a workspace argument through every signature.

import { parseProblem } from "@glyphs-ai/sdk";

let activeWorkspace: string | null = null;

/** Called by the route layout whenever the URL's workspaceId segment changes. */
export function setActiveWorkspace(id: string | null): void {
  activeWorkspace = id;
}

/** Read the workspace currently in scope for the active route. */
export function getActiveWorkspace(): string | null {
  return activeWorkspace;
}

/**
 * Build the URL prefix for workspace-scoped resources. Throws if no
 * workspace is in scope — call sites should ensure the user is on a
 * `/workspaces/:workspaceId/...` route before issuing per-workspace requests.
 */
export function workspacePrefix(): string {
  if (!activeWorkspace) {
    throw new Error("no workspace selected");
  }
  return `/api/workspaces/${encodeURIComponent(activeWorkspace)}`;
}

export const fetchJson = async <T>(path: string, label: string): Promise<T> => {
  const r = await fetch(path);
  // Treat 202 as a typed "warming" surface: the server has acknowledged
  // the request but the per-workspace context isn't ready to serve
  // data yet. Without this branch `r.ok` would be true and the
  // `{state, workspaceId}` warming envelope would silently parse as
  // the typed payload — every caller would get a corrupted response.
  // Surface as `ApiError` so call sites can branch on
  // `code === "WorkspaceWarming"` instead of guessing from message text.
  if (r.status === 202) throw await buildApiError(r);
  if (!r.ok) {
    throw new Error(`${label}: ${r.status}`);
  }
  return r.json() as Promise<T>;
};

/**
 * Structured error thrown by {@link mutate} and {@link mutateJson} on a
 * non-OK response. Extends `Error`
 * so UI surfaces can use `instanceof Error` / `err.message`; the
 * message field carries the server-provided `detail` text from the
 * RFC 9457 Problem envelope (or the bare HTTP status as fallback).
 *
 * The extra fields let typed UI surfaces (e.g. the create-workflow
 * modal pinning a `coordinatorAgent` rejection inline next to the
 * select) branch on `code` / `field` without string-matching the
 * message. Both are present iff the server included them in the
 * structured 4xx envelope.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly field?: string;

  constructor(message: string, opts: { status: number; code?: string; field?: string }) {
    super(message);
    this.name = "ApiError";
    this.status = opts.status;
    if (opts.code !== undefined) this.code = opts.code;
    if (opts.field !== undefined) this.field = opts.field;
  }
}

/**
 * Build (do NOT throw) an {@link ApiError} from a non-OK fetch response.
 * Call sites use the literal `throw await buildApiError(r)` form so the
 * `throw` keyword stays textually visible in the transport — a grep for
 * `throw` over `http.ts` surfaces every error branch, instead of hiding
 * them inside a helper named `throwApiError` that returns `never`.
 *
 * The error body is decoded through the SDK's shared {@link parseProblem}
 * so the dashboard and CLI narrow the RFC 9457 envelope one identical way.
 * The one non-Problem surface is the 202 warming envelope
 * (`{ state: "warming", workspaceId }`), which rides in `application/json`
 * — `parseProblem` leaves it unread (wrong content-type) so it is handled
 * here.
 */
async function buildApiError(r: Response): Promise<ApiError> {
  const problem = await parseProblem(r);
  if (problem) {
    return new ApiError(problem.detail, {
      status: r.status,
      code: problem.code,
      ...(typeof problem.field === "string" ? { field: problem.field } : {}),
    });
  }
  const warmingWorkspace = await readWarmingWorkspace(r);
  if (warmingWorkspace !== undefined) {
    return new ApiError(`workspace "${warmingWorkspace}" is warming up`, {
      status: r.status,
      code: "WorkspaceWarming",
    });
  }
  return new ApiError(`${r.status}`, { status: r.status });
}

/**
 * Read the workspace id off a 202 warming envelope
 * (`{ state: "warming", workspaceId }`), or `undefined` if the body isn't
 * that shape. Defensive: a non-JSON body must not throw inside the error
 * path.
 */
async function readWarmingWorkspace(r: Response): Promise<string | undefined> {
  try {
    const body: unknown = await r.json();
    if (
      body !== null &&
      typeof body === "object" &&
      (body as { state?: unknown }).state === "warming" &&
      typeof (body as { workspaceId?: unknown }).workspaceId === "string"
    ) {
      return (body as { workspaceId: string }).workspaceId;
    }
  } catch {
    // body not JSON; not a warming envelope
  }
  return undefined;
}

export const mutate = async (path: string, init: RequestInit): Promise<void> => {
  const r = await fetch(path, init);
  if (r.status === 202 || !r.ok) throw await buildApiError(r);
};

export const mutateJson = async <T>(path: string, init: RequestInit): Promise<T> => {
  const r = await fetch(path, init);
  if (r.status === 202 || !r.ok) throw await buildApiError(r);
  return (await r.json()) as T;
};

export const jsonInit = (method: string, body: object): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
