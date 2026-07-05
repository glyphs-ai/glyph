import { z } from "zod";

/**
 * Validated __Entity__ name value object: non-empty after trim, at most
 * 128 characters. Branding keeps raw strings from crossing boundaries that
 * require a validated name, so per-property validation is owned by the
 * domain and reused wherever a name is accepted (request bodies included).
 */
export const __Entity__NameSchema = z
  .string()
  .refine((s) => s.trim().length > 0, "must be non-empty after trim")
  .refine((s) => s.length <= 128, "must be at most 128 characters")
  .brand("__Entity__Name");

export type __Entity__Name = z.infer<typeof __Entity__NameSchema>;
