import { z } from "zod";

/**
 * Display name for a workspace. Non-empty after trim, ≤ 64 chars, no
 * ASCII control characters. Branded so a raw string can't be passed
 * where a validated name is required (see `workspace-id.ts` for the
 * brand-naming convention).
 */
export const WorkspaceNameSchema = z
  .string()
  .refine((s) => s.trim().length > 0, "must be non-empty after trim")
  .refine((s) => s.length <= 64, "must be at most 64 characters")
  // biome-ignore lint/suspicious/noControlCharactersInRegex: detecting control chars in user input is the point.
  .refine((s) => !/[\u0000-\u001F\u007F]/.test(s), "must not contain control characters")
  .brand("WorkspaceName");

export type WorkspaceName = z.infer<typeof WorkspaceNameSchema>;
