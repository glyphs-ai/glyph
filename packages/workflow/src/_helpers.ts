/**
 * Pkg-internal helpers shared between service / repository. Pure /
 * best-effort utilities with no DB coupling.
 */

import { rm } from "node:fs/promises";
import type { Logger } from "pino";

/**
 * Best-effort recursive `rm` mirroring `@glyphs-ai/task`'s
 * `safeRm` in `task-service/_helpers.ts`. Idempotent (ENOENT is
 * suppressed by `force: true`); a real fs error is warn-logged but
 * not rethrown — used on rollback paths and `purge`, neither of
 * which can do anything useful with a failed cleanup.
 */
export async function safeRmDir(p: string, logger: Logger): Promise<void> {
  try {
    await rm(p, { recursive: true, force: true });
  } catch (err) {
    logger.warn(
      {
        path: p,
        err,
      },
      "workflow: failed to remove workflowDir during cleanup",
    );
  }
}
