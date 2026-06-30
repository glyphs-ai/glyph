/**
 * Application-layer use-case contract. `execute` is synchronous and
 * returns the `ResultAsync` chain directly (uniform with catalog /
 * workspace). Each use-case file owns its Zod `RequestSchema` +
 * `ResponseSchema` and its `Error` union.
 */

import type { ResultAsync } from "neverthrow";

export type UseCaseResult<T, E> = ResultAsync<T, E>;

export interface UseCase<Req, Res, Err> {
  execute(request: Req): UseCaseResult<Res, Err>;
}
