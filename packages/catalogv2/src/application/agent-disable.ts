/**
 * Use case: disable an agent.
 *
 * Schema-first contract (request + response). The response shape is
 * inline per use-case — no shared view type — so future field
 * additions (e.g. `disabledAt`) stay local to this use-case.
 *
 * Domain branding at the boundary: schema's `id` is plain `z.string()`
 * (wire-friendly), use-case calls `agentId(request.id)` to brand it
 * before handing off to the repository.
 *
 * Flow (load → mutate → save), in pure neverthrow chain form:
 *   1. `agentRepo.get(...)` → ResultAsync<Agent, AgentNotFound | DatabaseUnavailable>
 *   2. `agent.disable()` → Result<void, AgentAlreadyDisabled>
 *      (sync; `andThen` lifts it back into the async chain)
 *   3. `agentRepo.save(agent)` → ResultAsync<void, DatabaseUnavailable>
 *   4. project to the response DTO inline.
 *
 * No try/catch, no manual isErr branches — TS infers the final error
 * type as the precise union of every variant the chain can emit.
 *
 * When requirements grow — cancel running executions, remove
 * schedules, update search index, publish an event — each step is a
 * coordination call ADDED to this chain. None of them belong inside
 * `Agent.disable()`; an aggregate doesn't know about Execution,
 * Schedule, Search, or Publisher.
 */

import { z } from "zod";
import { agentId } from "../domain/agent-entity.js";
import type { AgentAlreadyDisabled } from "../domain/agent-errors.js";
import type {
  AgentNotFound,
  AgentRepository,
  DatabaseUnavailable,
} from "../domain/agent-repository.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const DisableAgentRequestSchema = z.object({
  id: z.string(),
});
export type DisableAgentRequest = z.infer<typeof DisableAgentRequestSchema>;

export const DisableAgentResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  skills: z.array(z.string()),
});
export type DisableAgentResponse = z.infer<typeof DisableAgentResponseSchema>;

/**
 * Per-use-case error union: atomic DU types, drawn from every layer
 * the use-case touches. The repository port exposes NO per-op aliases
 * — only its atoms — because the repository is internal, not a public
 * contract. The use-case IS the contract, and that contract is THIS
 * alias. Adding a new variant here is a deliberate re-audit.
 */
export type DisableAgentError = AgentNotFound | AgentAlreadyDisabled | DatabaseUnavailable;

export interface DisableAgentDeps {
  readonly agentRepo: AgentRepository;
}

export class DisableAgentUseCase
  implements UseCase<DisableAgentRequest, DisableAgentResponse, DisableAgentError>
{
  constructor(private readonly deps: DisableAgentDeps) {}

  async execute(
    request: DisableAgentRequest,
  ): UseCaseResult<DisableAgentResponse, DisableAgentError> {
    return this.deps.agentRepo
      .get(agentId(request.id))
      .andThen((agent) => agent.disable().map(() => agent))
      .andThen((agent) => this.deps.agentRepo.save(agent).map(() => agent))
      .map((agent) => ({
        id: agent.id,
        name: agent.name,
        enabled: agent.enabled,
        skills: [...agent.skills],
      }));
  }
}
