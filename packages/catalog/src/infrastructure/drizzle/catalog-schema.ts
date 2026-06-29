/**
 * Schema barrel — the catalog persistence surface, owned by the adapter.
 * Re-exports the per-kind table definitions so `openDb` parameterizes one
 * drizzle handle over every table and `drizzle-kit` reads a single schema
 * entrypoint. No domain or application code imports this file.
 */

export * from "./agent-schema.js";
export * from "./mcp-schema.js";
export * from "./skill-schema.js";
