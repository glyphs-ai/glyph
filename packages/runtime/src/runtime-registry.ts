import { err, ok, type Result } from "neverthrow";
import type { UnknownRuntime } from "./errors.js";
import type { Runtime } from "./types.js";

/**
 * Lookup port over registered {@link Runtime} adapters. Result-based:
 * `get` returns `err(UnknownRuntime)` instead of throwing, so consumers
 * stay on the Result rail. Consumed by `@glyphs-ai/session` and
 * `@glyphs-ai/task`; satisfied at the composition root by
 * {@link InMemoryRuntimeRegistry} (production) or any fake (tests).
 */
export interface RuntimeRegistry {
  /** True iff `kind` resolves to a registered adapter. */
  has(kind: string): boolean;
  /** Resolve `kind` to its adapter, or `err(UnknownRuntime)` when absent. */
  get(kind: string): Result<Runtime, UnknownRuntime>;
  /** All registered kinds, in registration order. */
  kinds(): string[];
}

/**
 * In-memory {@link RuntimeRegistry}. Implementations register themselves at
 * server bootstrap; lookup is the only operation used at request time.
 *
 * Not concurrent-safe in the strict sense, but registration only happens at
 * startup and lookup is `Map.get`, so practical concurrency is not a concern.
 */
export class InMemoryRuntimeRegistry implements RuntimeRegistry {
  private readonly runtimes = new Map<string, Runtime>();

  /**
   * Add `runtime` to the registry. If a runtime with the same `kind` is
   * already registered, throws — duplicate registration is always a bug
   * (rather than silently overwriting and losing the previous instance).
   * This is a bootstrap-time fault, not a Result-flow error.
   */
  register(runtime: Runtime): void {
    if (this.runtimes.has(runtime.kind)) {
      throw new Error(`runtime ${JSON.stringify(runtime.kind)} is already registered`);
    }
    this.runtimes.set(runtime.kind, runtime);
  }

  get(kind: string): Result<Runtime, UnknownRuntime> {
    const r = this.runtimes.get(kind);
    return r ? ok(r) : err({ type: "UnknownRuntime", runtime: kind });
  }

  has(kind: string): boolean {
    return this.runtimes.has(kind);
  }

  kinds(): string[] {
    return [...this.runtimes.keys()];
  }
}
