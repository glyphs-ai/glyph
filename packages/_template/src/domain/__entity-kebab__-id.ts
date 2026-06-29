import { z } from "zod";

/**
 * Branded identifier for a __Entity__. The brand stops raw strings
 * crossing boundaries that require a validated id.
 */
export const __Entity__IdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "must be a valid UUID")
  .brand("__Entity__Id");

export type __Entity__Id = z.infer<typeof __Entity__IdSchema>;
