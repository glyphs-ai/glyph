/**
 * Read-side file value object for catalog file listings, shared by the agent
 * and skill `list-*-files` read use-cases (their response element shape).
 */

export type CatalogFileEntry = {
  readonly relPath: string;
  readonly size: number;
};
