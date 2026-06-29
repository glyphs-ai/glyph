/**
 * Application-layer use-case contract.
 *
 * Every use-case implements `UseCase<Req, Res, Err>`:
 *
 *   - `Req` (Request): a plain readonly DTO that names every parameter.
 *   - `Res` (Response): the success value, typically a view projection.
 *   - `Err` (Error): the per-call error union.
 *
 * `Err` (not `Error`) keeps the generic from shadowing the global
 * `Error` builtin inside implementation files. The runtime error type is
 * typically a discriminated union of `{ type: "..." }` variants.
 *
 * `UseCaseResult<T, E>` is the strict outer contract: a
 * `Promise<Result<T, E>>`. Use-cases may use `ResultAsync<T, E>` internally;
 * `async execute()` collapses the chain into the outer shape via `await`.
 *
 * Validation policy: each use-case file exports a Zod `RequestSchema`
 * and `ResponseSchema` as the public contract. Runtime validation
 * happens at the outer boundary before `execute`. The schemas define both
 * the TS type (`z.infer`) and the wire format.
 */

import type { Result } from "neverthrow";

export type UseCaseResult<T, E> = Promise<Result<T, E>>;

export interface UseCase<Req, Res, Err> {
  execute(request: Req): UseCaseResult<Res, Err>;
}
