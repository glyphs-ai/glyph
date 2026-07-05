import { Cron } from "croner";
import { err, ok, type Result } from "neverthrow";

/**
 * Cron domain service — the schedule domain's cron authority. Pure,
 * stateless functions; the only IO-ish input (`after`) is passed in.
 *
 * croner lives HERE, in the domain, deliberately: the only way to TRULY
 * guarantee an expression is legal is to parse it with the same engine
 * that computes its fires. A hand-written grammar check would risk
 * divergence — the domain calling an expression "valid" that croner then
 * can't compute, yielding a schedule that persists but silently never
 * fires. `Cron(...)` construction + `nextRun` are deterministic pure
 * computation (no IO), so they qualify as a domain calculation rather than
 * an infrastructure adapter; cron IS this domain's core concept.
 *
 * Human-readable description (`describe`, via cronstrue) is presentation,
 * not a domain rule, and lives outside the domain (see
 * `infrastructure/cron/describe.ts`).
 */

const FIVE_FIELD_RE = /^\s*\S+\s+\S+\s+\S+\s+\S+\s+\S+\s*$/;

/** A cron expression is not a legal 5-field POSIX form. */
export type InvalidCronExpr = {
  readonly type: "InvalidCronExpr";
  readonly expr: string;
  readonly reason: string;
};

/** A timezone string is not a valid IANA zone. */
export type InvalidTimezone = {
  readonly type: "InvalidTimezone";
  readonly tz: string;
};

/**
 * Validate a 5-field cron expression. Rejects 6-field (sub-minute) cron —
 * the dialect is locked to the POSIX/Vixie/Kubernetes/GH Actions standard
 * so users get a predictable surface across editors. croner's parser is
 * the source of truth for field-level legality.
 */
export function validateCron(expr: string): Result<void, InvalidCronExpr> {
  if (typeof expr !== "string" || !FIVE_FIELD_RE.test(expr)) {
    return err({
      type: "InvalidCronExpr",
      expr: String(expr),
      reason: "6-field cron not supported in v1; use 5-field POSIX form",
    });
  }
  try {
    // croner Cron() throws synchronously on malformed expressions.
    new Cron(expr, { paused: true });
  } catch (cause) {
    return err({
      type: "InvalidCronExpr",
      expr,
      reason: cause instanceof Error ? cause.message : String(cause),
    });
  }
  return ok(undefined);
}

/** Validate an IANA timezone string via the platform `Intl` API. */
export function validateTimezone(tz: string): Result<void, InvalidTimezone> {
  try {
    // Intl.DateTimeFormat throws RangeError on an unknown IANA tz.
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    return err({ type: "InvalidTimezone", tz });
  }
  return ok(undefined);
}

/**
 * Compute the next N fires (ISO strings) from `after` for the given cron +
 * tz. The cursor advances to each computed `next` before the next call —
 * reusing the same `after` for every iteration would otherwise return N
 * copies of the first fire. Pre-condition: `expr`/`tz` already validated.
 */
export function nextRuns(expr: string, tz: string, after: Date, n: number): string[] {
  const c = new Cron(expr, { timezone: tz, paused: true });
  const runs: string[] = [];
  let cursor = after;
  for (let i = 0; i < n; i++) {
    const next = c.nextRun(cursor);
    if (next === null) break;
    runs.push(next.toISOString());
    cursor = next;
  }
  return runs;
}
