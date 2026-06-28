/**
 * Domain errors as discriminated unions, NOT classes.
 *
 * Why DU over class:
 *   - `switch (err.type) { case "AgentAlreadyDisabled": ... }` narrows
 *     exhaustively. Adding a variant surfaces every incomplete switch
 *     as a TS error at compile time. `instanceof` chains give you none
 *     of that.
 *   - Plain value semantics: no `new`, no prototype chain, no stack
 *     trace. These are values flowing through `Result`, never thrown.
 *
 * Throwing policy: domain code NEVER throws these — it returns them
 * via `Result<void, ...>`.
 */

export type AgentAlreadyDisabled = {
  readonly type: "AgentAlreadyDisabled";
  readonly agentId: string;
};

export type AgentAlreadyEnabled = {
  readonly type: "AgentAlreadyEnabled";
  readonly agentId: string;
};

export type InvalidAgentName = {
  readonly type: "InvalidAgentName";
  readonly value: string;
  readonly reason: string;
};

export type SkillAlreadyAttached = {
  readonly type: "SkillAlreadyAttached";
  readonly agentId: string;
  readonly skillId: string;
};

export type SkillNotAttached = {
  readonly type: "SkillNotAttached";
  readonly agentId: string;
  readonly skillId: string;
};

/**
 * Returned by `AgentEntity.fromManifest` when the manifest fails
 * domain-level validity checks (beyond what the metadata Zod schema
 * already covers). Examples: required field empty after schema
 * default, dep ref shape malformed.
 */
export type InvalidManifest = {
  readonly type: "InvalidManifest";
  readonly reason: string;
};

/**
 * Aggregate-wide alias for "any rule the Agent domain can refuse".
 * Use-case error unions reference SPECIFIC variants, not this alias —
 * `AgentError` is for consumers wanting to handle "any Agent domain
 * violation" generically.
 */
export type AgentError =
  | AgentAlreadyDisabled
  | AgentAlreadyEnabled
  | InvalidAgentName
  | SkillAlreadyAttached
  | SkillNotAttached
  | InvalidManifest;
