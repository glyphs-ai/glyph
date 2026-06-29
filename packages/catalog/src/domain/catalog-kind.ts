/**
 * `CatalogKind` — the three kinds of catalog entity. A fundamental domain
 * discriminator shared by entities, manifests, the dependency graph, and
 * every use-case that branches per kind. The schema is the single source
 * of truth; adapter boundaries parse through it.
 */

import { z } from "zod";

export const CatalogKindSchema = z.enum(["skill", "agent", "mcp"]);
export type CatalogKind = z.infer<typeof CatalogKindSchema>;
