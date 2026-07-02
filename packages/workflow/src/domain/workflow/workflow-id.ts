import { randomBytes as cryptoRandomBytes } from "node:crypto";
import { z } from "zod";

/**
 * Canonical workflow id: `YYYYMMDD-xxxxxxxx` (UTC-date prefix + 8 lowercase
 * hex chars). Generation stays in the application layer; the domain owns the
 * format and brand used at boundaries.
 */
export const WorkflowIdSchema = z
  .string()
  .regex(/^\d{8}-[0-9a-f]{8}$/, "must be YYYYMMDD-xxxxxxxx")
  .brand("WorkflowId");

export type WorkflowId = z.infer<typeof WorkflowIdSchema>;

/** The caller-supplied value did not match the canonical workflow-id format. */
export type InvalidWorkflowId = {
  readonly type: "InvalidWorkflowId";
  readonly id: unknown;
};

/**
 * Workflow id generator. Returns `<YYYYMMDD>-<8 lowercase hex>` — UTC
 * date prefix for at-a-glance grouping in `ls` output, ~4B-id-per-day
 * collision space from the 4 random bytes. Mirrors
 * `@glyphs-ai/task`'s `generateTaskId` so operators see a consistent
 * id pattern across both surfaces.
 *
 * `now` and `randomBytes` are injectable seams so tests can produce
 * deterministic ids by stubbing both.
 */
export function generateWorkflowId(
  now: () => Date = () => new Date(),
  randomBytes: (n: number) => Buffer = cryptoRandomBytes,
): WorkflowId {
  const d = now();
  const date = `${pad4(d.getUTCFullYear())}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
  const suffix = randomBytes(4).toString("hex");
  return WorkflowIdSchema.parse(`${date}-${suffix}`);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function pad4(n: number): string {
  return n.toString().padStart(4, "0");
}
