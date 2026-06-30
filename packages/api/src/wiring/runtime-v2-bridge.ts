import type {
  RuntimeRegistry as RuntimeRegistryV1,
  Runtime as RuntimeV1,
} from "@glyphs-ai/runtime";
import {
  InMemoryRuntimeRegistry,
  type RuntimeLaunchFailed,
  type RuntimeProvisionFailed,
  type RuntimeRegistry as RuntimeRegistryV2,
  type RuntimeStateDeletionFailed,
  type Runtime as RuntimeV2,
} from "@glyphs-ai/runtime-v2";
import { okAsync, ResultAsync } from "neverthrow";

/**
 * Transitional bridge: wrap a throw-based v1 `RuntimeRegistry`
 * (`@glyphs-ai/runtime`) into the Result-based `@glyphs-ai/runtime-v2`
 * contract that `@glyphs-ai/session` consumes. Each registered v1
 * runtime is adapted into a v2 `Runtime` — throws become DU errors; the
 * structurally-identical data types pass through unchanged.
 *
 * Lives here in the composition root (not in either runtime package)
 * because only api may value-import both v1 and v2 (T0↔T0 value-imports
 * are fenced off). Dropped once concrete adapters implement v2 natively.
 */
export function bridgeRuntimeRegistryToV2(v1: RuntimeRegistryV1): RuntimeRegistryV2 {
  const v2 = new InMemoryRuntimeRegistry();
  for (const kind of v1.kinds()) {
    v2.register(legacyRuntime(v1.get(kind)));
  }
  return v2;
}

function legacyRuntime(v1: RuntimeV1): RuntimeV2 {
  return {
    kind: v1.kind,
    ...(v1.capabilities !== undefined ? { capabilities: v1.capabilities } : {}),
    provision: (opts) =>
      ResultAsync.fromPromise(
        v1.provision({
          workdir: opts.workdir,
          agent: opts.agent,
          catalog: opts.contentSource,
          workspaceDir: opts.workspaceDir,
        }),
        (cause): RuntimeProvisionFailed => ({ type: "RuntimeProvisionFailed", cause }),
      ),
    buildInteractiveLaunch: (runtimeSessionId, opts) =>
      ResultAsync.fromPromise(
        v1.buildInteractiveLaunch(runtimeSessionId, opts),
        (cause): RuntimeLaunchFailed => ({ type: "RuntimeLaunchFailed", cause }),
      ),
    readMetadata: (runtimeSessionId) =>
      typeof v1.readMetadata === "function"
        ? ResultAsync.fromPromise(v1.readMetadata(runtimeSessionId), (cause) => cause).orElse(() =>
            okAsync(null),
          )
        : okAsync(null),
    deleteState: (runtimeSessionId) =>
      ResultAsync.fromPromise(
        v1.deleteState(runtimeSessionId),
        (cause): RuntimeStateDeletionFailed => ({ type: "RuntimeStateDeletionFailed", cause }),
      ),
  };
}
