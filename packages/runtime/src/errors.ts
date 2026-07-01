/**
 * Runtime error atoms - discriminated-union values flowing through
 * `Result`, not thrown exceptions. Each {@link Runtime} method maps any
 * underlying driver/CLI fault into one of these; `cause` carries the
 * original for server-side logging and stays off the wire.
 */

/** The requested runtime kind is not registered in the active registry. */
export type UnknownRuntime = {
  readonly type: "UnknownRuntime";
  readonly runtime: string;
};

/** {@link Runtime.provision} failed to bake the agent into the workdir. */
export type RuntimeProvisionFailed = {
  readonly type: "RuntimeProvisionFailed";
  readonly cause: unknown;
};

/** {@link Runtime.buildInteractiveLaunch} failed to assemble the launch. */
export type RuntimeLaunchFailed = {
  readonly type: "RuntimeLaunchFailed";
  readonly cause: unknown;
};

/** {@link Runtime.launchHeadless} failed before the subprocess was running. */
export type RuntimeHeadlessLaunchFailed = {
  readonly type: "RuntimeHeadlessLaunchFailed";
  readonly cause: unknown;
};

/** {@link Runtime.readActivity} hit a real I/O or parse fault. */
export type RuntimeActivityReadFailed = {
  readonly type: "RuntimeActivityReadFailed";
  readonly cause: unknown;
};

/** {@link Runtime.deleteState} failed to drop the runtime's session state. */
export type RuntimeStateDeletionFailed = {
  readonly type: "RuntimeStateDeletionFailed";
  readonly cause: unknown;
};
