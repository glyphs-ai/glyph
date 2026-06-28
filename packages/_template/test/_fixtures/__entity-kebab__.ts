import type { Create__Entity__Request } from "../../src/contract/__entity-kebab__.types.js";
import type { __Entity__Entity } from "../../src/domain/__entity-kebab__.entity.js";

/**
 * Test-data factories for `@glyphs-ai/__PKG__`. `a__Entity__` builds a
 * domain entity (what the repository returns); `aCreate__Entity__Request`
 * builds a service `create` input. Override any field via the partial.
 */
const DEFAULT_ID = "abcdef0123456789";
const DEFAULT_NAME = "Test __Entity__";
const DEFAULT_CREATED_AT = "2025-01-01T00:00:00.000Z";

export function a__Entity__(over: Partial<__Entity__Entity> = {}): __Entity__Entity {
  return { id: DEFAULT_ID, name: DEFAULT_NAME, createdAt: DEFAULT_CREATED_AT, ...over };
}

export function aCreate__Entity__Request(
  over: Partial<Create__Entity__Request> = {},
): Create__Entity__Request {
  return { name: DEFAULT_NAME, ...over };
}
