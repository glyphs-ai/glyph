/**
 * Application-layer use-case contract. Every use-case implements
 * `UseCase<Req, Res, Err>`:
 *
 *   - `Req`: the use-case's own readonly request DTO.
 *   - `Res`: the success value (a view projection).
 *   - `Err`: the per-call error union.
 *
 * `UseCaseResult<T, E>` is the uniform outer contract — a
 * `Promise<Result<T, E>>`. Use-cases may chain `ResultAsync` internally;
 * `async execute()` collapses the chain into the outer shape.
 *
 * Each use-case file owns a Zod `RequestSchema` + `ResponseSchema`. The
 * schema is both the entry validator (`execute` parses on entry) and the
 * inferred TS type (`z.infer`).
 */

import type { Result } from "neverthrow";

export type UseCaseResult<T, E> = Promise<Result<T, E>>;

export interface UseCase<Req, Res, Err> {
  execute(request: Req): UseCaseResult<Res, Err>;
}
