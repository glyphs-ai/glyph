import type { RuntimeHandle } from "@glyphs-ai/runtime";
import type {
  ExitOutcome,
  KillOutcome,
  KillReason,
  LiveProcessRegistry,
} from "../ports/live-process-registry.js";

interface LiveProcess {
  readonly handle: RuntimeHandle;
  /** Read AT exit time to classify the terminal status. */
  killReason: KillReason | null;
  /** Resolves once the post-exit `onExit` callback has finished. */
  settled: Promise<void>;
}

/**
 * In-memory {@link LiveProcessRegistry}. Holds one {@link RuntimeHandle} per
 * live subprocess, watches each for exit, runs the supplied `onExit`
 * orchestration, then drops the entry. Not concurrency-safe in the strict
 * sense, but every mutation happens on the single Node event loop.
 */
export class InMemoryLiveProcessRegistry implements LiveProcessRegistry {
  private readonly live = new Map<string, LiveProcess>();

  supervise(
    id: string,
    handle: RuntimeHandle,
    onExit: (outcome: ExitOutcome, killReason: KillReason | null) => Promise<void>,
  ): void {
    const entry: LiveProcess = { handle, killReason: null, settled: Promise.resolve() };
    // Assign `settled` before `set` so the entry is registered before the
    // first `await` inside the watcher yields the event loop.
    entry.settled = (async () => {
      let outcome: ExitOutcome;
      try {
        outcome = { kind: "exited", exit: await handle.exit };
      } catch (cause) {
        // handle.exit should never reject by construction; surface it as a
        // watch failure so the orchestrator records a typed terminal status.
        outcome = { kind: "watch-failed", cause };
      }
      await onExit(outcome, entry.killReason);
      this.live.delete(id);
    })();
    this.live.set(id, entry);
  }

  requestKill(id: string, reason: KillReason): KillOutcome {
    const entry = this.live.get(id);
    if (entry === undefined) return "not-live";
    if (entry.killReason !== null) return "already-killing";
    entry.killReason = reason;
    try {
      entry.handle.kill();
    } catch {
      // Already dead — let the exit watcher run its course.
    }
    return "killed";
  }

  awaitSettled(id: string): Promise<void> {
    return this.live.get(id)?.settled ?? Promise.resolve();
  }

  async killAll(reason: KillReason): Promise<void> {
    const snapshot = [...this.live.values()];
    for (const entry of snapshot) {
      // Per-process flag (not a global) so a process that self-exits cleanly
      // mid-shutdown is still classified by its natural exit.
      entry.killReason = reason;
      try {
        entry.handle.kill();
      } catch {
        // Already dead.
      }
    }
    await Promise.allSettled(snapshot.map((entry) => entry.settled));
  }

  size(): number {
    return this.live.size;
  }
}
