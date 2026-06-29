import type { ResultAsync } from "neverthrow";

/** Use-case outcome with `ResultAsync` chaining support. */
export type UseCaseResult<T, E> = ResultAsync<T, E>;

/** Single-method contract for application use-cases. */
export interface UseCase<Req, Res, Err> {
  execute(request: Req): UseCaseResult<Res, Err>;
}
