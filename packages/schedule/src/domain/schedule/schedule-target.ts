import { z } from "zod";

/**
 * Opaque per-kind target envelope persisted for every schedule row. The
 * `data` payload is `unknown` because the substrate deliberately doesn't
 * know the per-kind shape — the registered kind handler owns parsing /
 * validation / merge / dispatch of `data`. The schedule pkg has no built-in
 * knowledge of "task", "workflow", or any other concrete kind.
 *
 * On disk: `kind` lives in the `schedules.target_kind` column and `data` is
 * `JSON.stringify`ed into `schedules.target_json`. The kind is NOT
 * redundantly nested inside `target_json` — the row stores only the `data`
 * payload.
 */
export const ScheduleTargetEnvelopeSchema = z.object({
  kind: z.string(),
  data: z.unknown(),
});

export type ScheduleTargetEnvelope = z.infer<typeof ScheduleTargetEnvelopeSchema>;
