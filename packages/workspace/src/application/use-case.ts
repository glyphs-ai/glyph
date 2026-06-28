import type { ResultAsync } from "neverthrow";

/**
 * Outcome of a use-case execution. A `ResultAsync<T, E>` so callers
 * can compose use-cases with the `.andThen` / `.match` chain — the
 * `Application` facade in `@glyphs-ai/api` and the cross-use-case
 * orchestration in CLI / MCP all depend on this.
 *
 * Returning a plain `Promise<Result<T, E>>` would `await` cleanly but
 * lose `.andThen`. Each use-case implementation either:
 *   - returns a `ResultAsync` directly (`repo.findById(...).andThen(...)`)
 *   - wraps a sync path with `okAsync(...)` / `errAsync(...)`
 *   - hides an `async` body inside `ResultAsync.fromPromise(...)`
 */
export type UseCaseResult<T, E> = ResultAsync<T, E>;

/**
 * Single-method contract every application use-case implements. Each
 * class lives in its own file and exposes:
 *   - `<XxxRequestSchema>` / `<XxxRequest>` (zod input + inferred type)
 *   - `<XxxResponseSchema>` / `<XxxResponse>`
 *   - `<XxxError>` (discriminated-union alias scoped to this use-case)
 *   - `<XxxDeps>` (constructor injection: ports the use-case needs)
 *   - `class <XxxUseCase> implements UseCase<Req, Res, Err>`
 *
 * The `WorkspaceModule` composition root constructs each use-case once
 * and exposes them by name; HTTP routes / CLI commands / MCP handlers
 * all call the same `module.xxxUseCase.execute(request)` surface.
 */
export interface UseCase<Req, Res, Err> {
  execute(request: Req): UseCaseResult<Res, Err>;
}
