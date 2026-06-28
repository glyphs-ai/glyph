/**
 * Public API of `@glyphs-ai/catalog`.
 *
 * The barrel publishes only the `CatalogService` facade, the composition
 * hook, and the service's result/param types. Error classes, wire DTOs,
 * install-body validators, and the FQN grammar live behind
 * `@glyphs-ai/catalog/contract`.
 */

export type {
  CatalogConflict,
  CatalogInstalledEntry,
  CatalogInstallFailure,
  CatalogInstallResult,
  CatalogInstallSkip,
  CatalogPlan,
  CatalogPlanNode,
  CatalogSyncResult,
  McpResolveAdapter,
  McpResolvedNode,
  OrphanedEntry,
  PlanNodeDisposition,
} from "./application/catalog.plan-types.js";
export { CatalogService, type CatalogServiceOpts } from "./application/catalog.service.js";
export {
  type CatalogModule,
  type CatalogModuleOptions,
  composeCatalogModule,
} from "./catalog.compose.js";
