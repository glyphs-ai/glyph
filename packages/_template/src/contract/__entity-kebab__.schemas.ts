/**
 * zod schemas for `@glyphs-ai/__PKG__`. Plain `zod` (no hono) — the
 * single source of truth for input validation AND the inferred public
 * types in `./__entity-kebab__.types.ts`. When this BC is exposed over
 * HTTP, `@glyphs-ai/api`'s route module attaches `.openapi(...)` to
 * these same schemas, so the wire contract and the runtime validation
 * never drift.
 *
 * Each write operation has ONE input schema, shared by the HTTP route
 * (if any) and the service method — there is no separate wire-DTO vs
 * service-opts shape. The service validates its own inputs with
 * `Schema.parse(...)`, so a malformed input raises a `ZodError` (mapped
 * to a 400 `ValidationError` envelope at the api boundary) rather than a
 * hand-rolled `Invalid*Error`.
 */
import { z } from "zod";

// ─── Reusable scalar schemas ─────────────────────────────────

/** Grammar for `__entity__.id`: 1–64 chars of [a-zA-Z0-9_-]. */
export const __Entity__IdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,64}$/, "must be 1–64 chars of [a-zA-Z0-9_-]");

/** Display name: non-empty after trim, at most 64 chars. */
export const __Entity__NameSchema = z
  .string()
  .refine((s) => s.trim().length > 0, "must be non-empty after trim")
  .refine((s) => s.length <= 64, "must be at most 64 characters");

// ─── Operation input schemas (shared by route + service) ─────

/** `create` input — the new __entity__'s display name. */
export const Create__Entity__RequestSchema = z.object({ name: __Entity__NameSchema }).strict();

// ─── Response / projection schemas ───────────────────────────

/** The __entity__ wire DTO — the persisted row projected for transport. */
export const __Entity__Schema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
});
