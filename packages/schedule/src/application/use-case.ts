/**
 * Application-layer use-case contract. `execute` returns the `ResultAsync`
 * chain directly (uniform with workflow / session / catalog / workspace). Each
 * use-case file owns its Zod `Request` / `Response` schemas and its `Error`
 * discriminated union.
 */

import type { ResultAsync } from "neverthrow";

export type UseCaseResult<T, E> = ResultAsync<T, E>;

export interface UseCase<Req, Res, Err> {
  execute(request: Req): UseCaseResult<Res, Err>;
}
