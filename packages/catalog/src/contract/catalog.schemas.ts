/**
 * Input validators for catalog install endpoints. Pure functions
 * (no IO), thrown errors are catalog errors so the route layer can
 * map to status codes uniformly.
 *
 * Shared across HTTP boundaries so all channels enforce the same body
 * shape rules.
 *
 * **Wire shape**: clients send `{ origin: string }`. The origin URI
 * is the canonical identity in every layer of the system (catalog DB
 * rows, AGENTS.md / SKILL.md `dependencies:` blocks, fetcher
 * dispatch), so the wire body and the post-validated form are
 * identical. The dashboard presents a friendly `provider + location`
 * form to humans and assembles the canonical origin URI client-side
 * before posting.
 *
 * Format validation (GitHub tree URL, Azure DevOps Services URL, or
 * `file:` URI) is delegated to `parseOrigin` in `src/fetcher/origin.ts`,
 * which owns the authoritative scheme/format rules. The validator here
 * only enforces the wire-level shape: the field exists and is a non-empty
 * string.
 */

import { AgentFrontmatterError } from "../domain/agent.errors.js";
import { McpInvalidJsonError } from "../domain/mcp.errors.js";
import { SkillFrontmatterError } from "../domain/skill.errors.js";
import type {
  InstallAgentRequest,
  InstallMcpRequest,
  InstallSkillRequest,
} from "./catalog.types.js";

const REQUEST_PATH = "<request>";

/**
 * Validate the body of `POST /catalog/skills`. Throws on shape
 * violations; the route layer maps to HTTP 400.
 */
export function validateSkillInstallInput(raw: unknown): InstallSkillRequest {
  const obj = expectObject(raw, "skill");
  return { origin: requireOrigin(obj, "skill") };
}

/** Validate the body of `POST /catalog/agents`. Same shape as skills. */
export function validateAgentInstallInput(raw: unknown): InstallAgentRequest {
  const obj = expectObject(raw, "agent");
  return { origin: requireOrigin(obj, "agent") };
}

/**
 * Validate the body of `POST /catalog/mcps`. Same shape as skills /
 * agents — `name` is derived from the fetched JSON's `_meta.name`
 * field at install time, not from the request body.
 */
export function validateMcpInstallInput(raw: unknown): InstallMcpRequest {
  const obj = expectObject(raw, "mcp");
  return { origin: requireOrigin(obj, "mcp") };
}

function requireOrigin(obj: Record<string, unknown>, kind: "skill" | "agent" | "mcp"): string {
  const origin = requireNonEmptyString(obj, "origin", kind);
  return origin.trim();
}

function expectObject(raw: unknown, kind: "skill" | "agent" | "mcp"): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw kindError(kind, "request body must be a JSON object");
  }
  return raw as Record<string, unknown>;
}

function requireNonEmptyString(
  obj: Record<string, unknown>,
  key: string,
  kind: "skill" | "agent" | "mcp",
): string {
  const v = obj[key];
  if (typeof v !== "string" || v.length === 0) {
    throw kindError(kind, `\`${key}\` is required and must be a non-empty string`);
  }
  return v;
}

function kindError(kind: "skill" | "agent" | "mcp", reason: string): Error {
  if (kind === "skill") return new SkillFrontmatterError(REQUEST_PATH, reason);
  if (kind === "agent") return new AgentFrontmatterError(REQUEST_PATH, reason);
  return new McpInvalidJsonError(REQUEST_PATH, reason);
}
