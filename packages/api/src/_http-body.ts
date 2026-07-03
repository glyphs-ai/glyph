import type { Context } from "hono";

/**
 * Parse a JSON request body. Returns either the parsed value or an error
 * shape suitable for a 400 response. Caller validates the body further.
 */
export async function parseJsonBody<T = unknown>(
  c: Context,
): Promise<{ ok: true; body: T } | { ok: false; error: string }> {
  try {
    const body = (await c.req.json()) as T;
    return { ok: true, body };
  } catch {
    return { ok: false, error: "request body must be JSON" };
  }
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function unknownBodyKey(
  body: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): string | undefined {
  return Object.keys(body).find((key) => !allowed.has(key));
}

/**
 * Discriminated result of a request-body / query validator: a typed
 * `value` on success or a 400-ready `error` string on failure. Lifted
 * here so the schedules and workflows route files share one definition
 * instead of each redeclaring the same triple.
 */
export interface ValidationFail {
  readonly ok: false;
  readonly error: string;
}
export interface ValidationOk<T> {
  readonly ok: true;
  readonly value: T;
}
export type ValidationResult<T> = ValidationOk<T> | ValidationFail;
