/**
 * Application-layer use-case contract. Every use-case implements
 * `UseCase<Req, Res, Err>`:
 *
 *   - `Req`: the use-case's own readonly request DTO.
 *   - `Res`: the success value (a view projection).
 *   - `Err`: the per-call error union.
 *
 * `UseCaseResult<T, E>` is `ResultAsync<T, E>`: `execute` is synchronous and
 * returns the `ResultAsync` chain directly, so callers can keep chaining
 * (`.andThen`, `.map`) without awaiting.
 *
 * Each use-case file owns a Zod `RequestSchema` + `ResponseSchema`. The
 * schema is both the entry validator (`execute` parses on entry) and the
 * inferred TS type (`z.infer`).
 */

import type { ResultAsync } from "neverthrow";

export type UseCaseResult<T, E> = ResultAsync<T, E>;

export interface UseCase<Req, Res, Err> {
  execute(request: Req): UseCaseResult<Res, Err>;
}
