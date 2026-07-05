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
 * `UseCaseResult<T, E>` is `ResultAsync<T, E>`: `execute` is synchronous and
 * returns the `ResultAsync` chain directly, so callers can keep chaining
 * (`.andThen`, `.map`) without awaiting.
 *
 * Validation policy: each use-case file exports a Zod `RequestSchema`
 * and `ResponseSchema` as the public contract. The schemas define both
 * the TS type (`z.infer`) and the wire format.
 */

import type { ResultAsync } from "neverthrow";

export type UseCaseResult<T, E> = ResultAsync<T, E>;

export interface UseCase<Req, Res, Err> {
  execute(request: Req): UseCaseResult<Res, Err>;
}
