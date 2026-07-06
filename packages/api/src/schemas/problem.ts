/**
 * Problem Details — the single wire shape for every HTTP error.
 *
 * This module is the transport-agnostic source of truth for the error
 * envelope: the zod schema (runtime validation + SDK codegen), the
 * `Problem` type, and the pure `toProblem` assembler the server's error
 * seam uses to project a domain error into the wire shape. It has no
 * `hono` / `@hono/zod-openapi` import — the architecture fence keeps the
 * wire schema pure zod, exactly like the other `schemas/*` modules.
 *
 * Wire shape:
 *
 * ```json
 * {
 *   "type":   "https://errors.glyph.ai/entry-not-ready",
 *   "title":  "Entry not ready",
 *   "status": 409,
 *   "detail": "coord node a2cd31c6 is still running, cannot start workflow",
 *   "code":   "EntryNotReady",
 *   "agent":  "official/coordinator",
 *   "reason": { "kind": "disabledByUser" }
 * }
 * ```
 *
 * - **Core members**: `type` (URI), `title`, `status`, `detail`,
 *   `instance?`.
 * - **Glyph extensions**: `code` (machine-stable discriminator = a DU
 *   `.type` or class `.name`) plus atom-specific members (`agent`,
 *   `reason`, `transition`, `fromStatus`, `field`, `issues`, …).
 *   Arbitrary extension members beyond the named ones are permitted.
 * - **Content-Type**: `application/problem+json`.
 */

import { z } from "zod";

/** The media type every error response carries. */
export const PROBLEM_CONTENT_TYPE = "application/problem+json";

/**
 * Stable prefix for the `type` URI. Not required to resolve to a served
 * document — an API-controlled URI is allowed to serve purely as a
 * stable identifier. `toProblem` derives the full URI mechanically from
 * `code`.
 */
export const PROBLEM_TYPE_PREFIX = "https://errors.glyph.ai/";

/** A single field-level problem carried by a `ValidationError`. */
export const ProblemIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
});
export type ProblemIssue = z.infer<typeof ProblemIssueSchema>;

/**
 * The Problem Details object plus glyph extensions. `catchall` keeps the
 * object open so extension members beyond the named ones round trip
 * through validation.
 */
export const ProblemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string(),
    instance: z.string().optional(),
    code: z.string(),
    // Named extensions consumed by the CLI / dashboard error UI.
    agent: z.string().optional(),
    reason: z.unknown().optional(),
    transition: z.string().optional(),
    fromStatus: z.string().optional(),
    field: z.string().optional(),
    issues: z.array(ProblemIssueSchema).optional(),
  })
  .catchall(z.unknown());

export type Problem = z.infer<typeof ProblemSchema>;

/**
 * Convert a machine-stable `code` (PascalCase discriminator) into the
 * kebab-case slug used in the `type` URI. `AgentNotFound` →
 * `agent-not-found`, `WorkflowSubgraphInvalid` →
 * `workflow-subgraph-invalid`, `ValidationError` → `validation-error`.
 */
export function kebabCase(code: string): string {
  return code
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

/** The stable `type` URI for a `code`: prefix + kebab-cased code. */
export function problemTypeUri(code: string): string {
  return `${PROBLEM_TYPE_PREFIX}${kebabCase(code)}`;
}

/** Structured input for {@link toProblem} — the resolved wire fields. */
export interface ProblemInput {
  readonly status: number;
  readonly title: string;
  readonly detail: string;
  readonly code: string;
  readonly instance?: string;
  /** Extension members (`agent`, `reason`, `transition`, …); `undefined` values are dropped. */
  readonly extensions?: Record<string, unknown>;
}

/**
 * Assemble a {@link Problem} from resolved fields. Pure: derives the
 * `type` URI from `code`, spreads defined extension members, and omits
 * `undefined` values so the wire body stays clean.
 */
export function toProblem(input: ProblemInput): Problem {
  const problem: Problem = {
    type: problemTypeUri(input.code),
    title: input.title,
    status: input.status,
    detail: input.detail,
    code: input.code,
  };
  if (input.instance !== undefined) problem.instance = input.instance;
  if (input.extensions !== undefined) {
    for (const [key, value] of Object.entries(input.extensions)) {
      if (value !== undefined) (problem as Record<string, unknown>)[key] = value;
    }
  }
  return problem;
}

/**
 * The 400 `ValidationError` Problem. Shared by the request `defaultHook`,
 * the `onError` ZodError branch, and the service-layer ZodError path in
 * the error seam so body validation and service-input validation are
 * indistinguishable on the wire.
 */
export function validationProblem(issues: ReadonlyArray<ProblemIssue>): Problem {
  return toProblem({
    status: 400,
    title: "Validation error",
    detail: "request validation failed",
    code: "ValidationError",
    extensions: { issues: [...issues] },
  });
}

/**
 * Hand-authored JSON Schema for the Problem envelope, injected into the
 * assembled OpenAPI document as `components/schemas/Problem`. Kept
 * hand-written (rather than derived via `z.toJSONSchema`) so the codegen
 * drift snapshot is stable regardless of the zod version's JSON-Schema
 * emitter.
 */
export const PROBLEM_JSON_SCHEMA = {
  type: "object",
  description: "RFC 9457 Problem Details error envelope.",
  properties: {
    type: { type: "string", format: "uri" },
    title: { type: "string" },
    status: { type: "integer" },
    detail: { type: "string" },
    instance: { type: "string" },
    code: { type: "string" },
    agent: { type: "string" },
    reason: {},
    transition: { type: "string" },
    fromStatus: { type: "string" },
    field: { type: "string" },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          message: { type: "string" },
        },
        required: ["path", "message"],
      },
    },
  },
  required: ["type", "title", "status", "detail", "code"],
  additionalProperties: true,
} as const;
