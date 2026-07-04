/**
 * Route for `/api/workspaces/:id/schedules/preview-cron` — a KINDLESS cron
 * calculator. Unlike every other schedule endpoint it touches no stored row:
 * it computes the next fires + English description for an arbitrary
 * `(expr, tz)` so the create-schedule modal can preview before any schedule
 * exists. It is the one honest exception to the per-kind split (task /
 * workflow schedules live in `routes/schedules/scheduled-tasks.ts` /
 * `routes/schedules/scheduled-workflows.ts`), mounted at its own sibling prefix.
 */

import { PreviewScheduleResponseSchema, type ScheduleModule } from "@glyphs-ai/schedule";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { respondScheduleError } from "../../_error-policies/schedules.js";
import { createApiApp, errorResponse, jsonResponse } from "../../_http-helpers.js";

type ScheduleServiceResolver = (c: Context) => ScheduleModule;

const PreviewCronQuerySchema = z.object({
  expr: z.string().min(1),
  tz: z.string().min(1),
  n: z.coerce.number().int().min(1).max(100).optional(),
});

export function schedulesPreviewCronRoutes(resolve: ScheduleServiceResolver): OpenAPIHono {
  const app = createApiApp();

  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["schedules"],
      summary: "Preview an arbitrary cron expression",
      request: { query: PreviewCronQuerySchema },
      responses: {
        200: jsonResponse(PreviewScheduleResponseSchema, "Cron preview"),
        400: errorResponse("Missing or malformed query"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const { expr, tz, n } = c.req.valid("query");
      try {
        // Modal default of 5 upcoming fires (vs the per-schedule preview's 3).
        const preview = await resolve(c).previewSchedule.execute({ expr, tz, n: n ?? 5 });
        if (preview.isErr()) {
          return respondScheduleError(c, preview.error, { route: "schedules.previewCron" });
        }
        return c.json(preview.value);
      } catch (err) {
        return respondScheduleError(c, err, { route: "schedules.previewCron" });
      }
    },
  );

  return app;
}
