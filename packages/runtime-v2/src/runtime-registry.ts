import { err, ok, type Result } from "neverthrow";
import type { UnknownRuntime } from "./errors.js";
import type { Runtime } from "./runtime.js";

/**
 * Lookup port over registered {@link Runtime} adapters. Result-based:
 * `get` returns `UnknownRuntime` instead of throwing, so consumers stay
 * on the Result rail. Consumed by `@glyphs-ai/session`; satisfied at
 * the composition root by {@link InMemoryRuntimeRegistry} (production)
 * or any fake (tests).
 */
export interface RuntimeRegistry {
  /** True iff `kind` resolves to a registered adapter. */
  has(kind: string): boolean;
  /** Resolve `kind` to its adapter, or `UnknownRuntime` when absent. */
  get(kind: string): Result<Runtime, UnknownRuntime>;
  /** All registered kinds, in registration order. */
  kinds(): string[];
}

/**
 * In-memory {@link RuntimeRegistry}. Implementations register at
 * bootstrap; lookup is the only request-time operation. Duplicate
 * registration is a bootstrap-time bug and throws (not a Result-flow
 * error).
 */
export class InMemoryRuntimeRegistry implements RuntimeRegistry {
  private readonly runtimes = new Map<string, Runtime>();

  register(runtime: Runtime): void {
    if (this.runtimes.has(runtime.kind)) {
      throw new Error(`runtime ${JSON.stringify(runtime.kind)} is already registered`);
    }
    this.runtimes.set(runtime.kind, runtime);
  }

  has(kind: string): boolean {
    return this.runtimes.has(kind);
  }

  get(kind: string): Result<Runtime, UnknownRuntime> {
    const r = this.runtimes.get(kind);
    return r ? ok(r) : err({ type: "UnknownRuntime", runtime: kind });
  }

  kinds(): string[] {
    return [...this.runtimes.keys()];
  }
}
