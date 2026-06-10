import { CatalogError } from "../errors.js";
import type { CatalogKind } from "../types.js";

/**
 * Thrown when deleting an entity that other entities still depend on.
 * Raised inside the per-entity repository's delete transaction — the
 * repo counts reverse-dep rows and, if any exist, builds the dependent
 * list from the same tables (skill/agent → skill/mcp) and throws,
 * rolling back the empty delete.
 *
 * Lives in `_shared/` rather than `facade/` so per-entity repositories
 * can raise it without importing upward into the facade layer.
 */
export class HasDependentsError extends CatalogError {
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
