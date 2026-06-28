/**
 * Domain entity for `@glyphs-ai/workspace` — the pkg-owned shape the
 * repository returns and the application projects from.
 *
 * Hand-declared by the domain, NOT derived from the Drizzle table: the
 * domain states its own contract and the persistence layer maps its row
 * to/from this shape inside the repository (anemic BCs do so
 * structurally; see `WorkspaceRepository`). A workspace carries no
 * behaviour, so the entity is a plain `interface` — promote it to a
 * `class` with a `fromRow` constructor when state transitions /
 * invariants appear.
 *
 * Distinct from the wire `Workspace` DTO: `lastOpenedAt` is nullable
 * here (a freshly registered workspace may never have been opened); the
 * service coalesces it to a required value at the wire boundary
 * (`projectWorkspace`). Never re-exported from `index.ts` — external
 * consumers see only the DTO.
 */
export interface WorkspaceEntity {
  readonly id: string;
  readonly workspaceDir: string;
  readonly name: string;
  readonly createdAt: string;
  readonly lastOpenedAt: string | null;
}
