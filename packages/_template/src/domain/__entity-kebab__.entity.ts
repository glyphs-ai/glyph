/**
 * Domain entity for `@glyphs-ai/__PKG__` — the pkg-owned shape the
 * repository returns and the application projects from.
 *
 * Hand-declared by the domain, NOT derived from the Drizzle table: the
 * domain states its own contract and the persistence layer maps its row
 * to/from this shape inside the repository. Anemic default — a plain
 * `interface` with no behaviour; promote it to a `class` with a
 * `static fromRow(row)` constructor (and an explicit `rowToEntity`
 * projection in the repository) when state transitions / invariants
 * appear.
 *
 * Never re-exported from `index.ts`: external consumers see only the
 * wire `__Entity__` DTO. The entity is the contract between the
 * repository and the service inside this pkg.
 */
export interface __Entity__Entity {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
}
