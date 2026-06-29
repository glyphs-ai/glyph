/**
 * In-memory preview-token store for the two-phase catalog sync UX
 * (`POST .../sync/resolve` mints a token; `POST .../sync` redeems it).
 *
 * This is a transport-layer concern, not a catalog domain operation:
 * the plan is computed by the `resolveSyncPlan` use-case, stashed here
 * keyed by an opaque token, and handed back once to the apply route.
 * Tokens expire after `TTL_MS`; `take` is single-use.
 *
 * Per-workspace isolation: one `PlanStore` is derived per
 * `CatalogModule` instance via `planStoreFor` (a `WeakMap`), so a token
 * minted against one workspace's catalog cannot be redeemed against
 * another. The `WeakMap` lets the store be reclaimed when the
 * per-workspace module is torn down.
 */

import { randomUUID } from "node:crypto";
import type { CatalogModule, CatalogPlan } from "@glyphs-ai/catalog";

const TTL_MS = 5 * 60 * 1000;

interface CachedPlan {
  readonly plan: CatalogPlan;
  readonly expiresAt: number;
}

export class PlanStore {
  private readonly entries = new Map<string, CachedPlan>();

  cache(plan: CatalogPlan): string {
    this.evictExpired();
    const token = randomUUID();
    this.entries.set(token, { plan, expiresAt: Date.now() + TTL_MS });
    return token;
  }

  take(token: string): CatalogPlan | null {
    const entry = this.entries.get(token);
    if (entry === undefined) return null;
    this.entries.delete(token);
    return entry.expiresAt < Date.now() ? null : entry.plan;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [token, entry] of this.entries) {
      if (entry.expiresAt < now) this.entries.delete(token);
    }
  }
}

const stores = new WeakMap<CatalogModule, PlanStore>();

/** Per-workspace `PlanStore`, keyed by the workspace's `CatalogModule`. */
export function planStoreFor(catalog: CatalogModule): PlanStore {
  let store = stores.get(catalog);
  if (store === undefined) {
    store = new PlanStore();
    stores.set(catalog, store);
  }
  return store;
}
