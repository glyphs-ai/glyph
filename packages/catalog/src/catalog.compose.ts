import type { Logger } from "pino";
import { buildCatalogRuntime, CatalogService } from "./application/catalog.service.js";
import { openDb } from "./persistence/catalog.db.js";

export interface CatalogModuleOptions {
  readonly dbFile: string;
  readonly logger?: Logger;
}

export interface CatalogModule {
  readonly service: CatalogService;
  close(): Promise<void>;
}

export async function composeCatalogModule(opts: CatalogModuleOptions): Promise<CatalogModule> {
  const { db, close } = openDb(opts.dbFile);
  const rt = buildCatalogRuntime({
    db,
    ...(opts.logger !== undefined ? { logger: opts.logger } : {}),
  });
  const service = new CatalogService({ runtime: rt });
  return {
    service,
    async close() {
      close();
    },
  };
}
