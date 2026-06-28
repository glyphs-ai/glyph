import type { CatalogKind } from "./catalog.types.js";

/**
 * Thrown when deleting an entity that other entities still depend on.
 * The per-entity repository counts reverse-dep rows inside its delete
 * transaction and, if any remain, builds the dependent list and throws,
 * rolling back the empty delete.
 */
export class HasDependentsError extends Error {
  override readonly name = "HasDependentsError";

  constructor(
    public readonly targetName: string,
    public readonly dependents: readonly { kind: CatalogKind; name: string }[],
  ) {
    super(
      `cannot delete "${targetName}" — still referenced by ${dependents
        .map((d) => `${d.kind} ${d.name}`)
        .join(", ")}`,
    );
  }
}
