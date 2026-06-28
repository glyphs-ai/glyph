/**
 * Application-layer use-case contract.
 *
 * Every use-case implements `UseCase<Req, Res, Err>` — a tiny
 * three-parameter interface that fixes the application's external shape:
 *
 *   - `Req` (Request):  a plain readonly DTO that names every parameter
 *                       the use-case needs. Single-arg verbs still wrap
 *                       their request in a DTO so the dispatch shape is
 *                       uniform.
 *   - `Res` (Response): the use-case's success value (typically a view
 *                       projection, never a domain entity).
 *   - `Err` (Error):    the use-case's per-call error union — concrete
 *                       DU types, NOT layer aliases.
 *
 * `Err` (not `Error`) keeps the generic from shadowing the global
 * `Error` builtin inside implementation files. The runtime error type
 * is unconstrained — typically a discriminated union of `{ type: "..." }`
 * variants.
 *
 * Why a class + interface, not a free function:
 *   - Constructor injection lets the host wire repositories once at
 *     boot and reuse the same use-case for many calls.
 *   - The uniform `execute(request)` shape lets infra dispatchers
 *     (HTTP route handlers, scheduled job runners, CLI dispatchers)
 *     treat all use-cases the same — they only need to know the
 *     request/response/error contract, not each use-case's bespoke
 *     signature.
 *
 * `UseCaseResult<T, E>` is the strict outer contract: a
 * `Promise<Result<T, E>>`. Use-cases ARE free to use `ResultAsync<T, E>`
 * internally for fluent chaining (`andThen` / `map`); the `async
 * execute()` boundary collapses the chain into the Promise<Result>
 * shape via `await`.
 *
 * Validation policy: each use-case file exports a Zod `RequestSchema`
 * and `ResponseSchema` as the public contract. Runtime validation
 * happens at the OUTER boundary (HTTP route handler does
 * `RequestSchema.safeParse(rawJson)` and only then calls `execute`).
 * Inside `execute` the TS type IS the runtime guarantee — no
 * re-validation. The schema is the single source of truth for both
 * the TS type (`z.infer`) and the wire format.
 */

import type { Result } from "neverthrow";

export type UseCaseResult<T, E> = Promise<Result<T, E>>;

export interface UseCase<Req, Res, Err> {
  execute(request: Req): UseCaseResult<Res, Err>;
}
