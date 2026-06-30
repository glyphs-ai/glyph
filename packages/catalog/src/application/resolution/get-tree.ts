/**
 * Use case: walk the INSTALLED graph from a seed origin and return the deduped
 * reachable graph. Persisted dependency rows are fqn-based; the graph surface is
 * origin-based so it can be diffed against upstream manifests.
 */

import { err, ok, type Result, safeTry } from "neverthrow";
import { z } from "zod";
import type { AgentFqn } from "../../domain/agent-fqn.js";
import type { AgentRepository, DatabaseUnavailable } from "../../domain/agent-repository.js";
import type { CatalogKind } from "../../domain/catalog-kind.js";
import type { McpFqn } from "../../domain/mcp-fqn.js";
import type { McpRepository } from "../../domain/mcp-repository.js";
import type { SkillFqn } from "../../domain/skill-fqn.js";
import type { SkillRepository } from "../../domain/skill-repository.js";
import type { UseCase, UseCaseResult } from "../use-case.js";
import { EMPTY_DEP_REFS, ResolvedGraphSchema, type ResolvedNode } from "./dependency-graph.js";

export const GetTreeRequestSchema = z.object({ origin: z.string() });
export type GetTreeRequest = z.infer<typeof GetTreeRequestSchema>;

export const GetTreeResponseSchema = ResolvedGraphSchema;
export type GetTreeResponse = z.infer<typeof GetTreeResponseSchema>;

export type GetTreeError = DatabaseUnavailable;

export interface GetTreeDeps {
  readonly skill: SkillRepository;
  readonly agent: AgentRepository;
  readonly mcp: McpRepository;
}

export class GetTreeUseCase implements UseCase<GetTreeRequest, GetTreeResponse, GetTreeError> {
  constructor(private readonly repos: GetTreeDeps) {}

  execute(request: GetTreeRequest): UseCaseResult<GetTreeResponse, GetTreeError> {
    const self = this;
    return safeTry<GetTreeResponse, GetTreeError>(async function* () {
      const nodes = new Map<string, ResolvedNode>();
      const visited = new Set<string>();

      const visit = async (origin: string): Promise<Result<void, DatabaseUnavailable>> => {
        if (visited.has(origin)) return ok(undefined);
        visited.add(origin);
        const loaded = await self.load(origin);
        if (loaded.isErr()) return err(loaded.error);
        const node = loaded.value;
        if (node === null) return ok(undefined);
        nodes.set(origin, node);
        for (const depOrigin of [
          ...node.dependencyRefs.mcps,
          ...node.dependencyRefs.skills,
          ...node.dependencyRefs.agents,
        ]) {
          const r = await visit(depOrigin);
          if (r.isErr()) return err(r.error);
        }
        return ok(undefined);
      };

      yield* await visit(request.origin);
      return ok({ nodes: [...nodes.values()], conflicts: [] });
    });
  }

  private async load(origin: string): Promise<Result<ResolvedNode | null, DatabaseUnavailable>> {
    for (const kind of ["agent", "skill", "mcp"] as const) {
      const node = await this.loadKind(kind, origin);
      if (node.isErr()) return err(node.error);
      if (node.value !== null) return ok(node.value);
    }
    return ok(null);
  }

  private async loadKind(
    kind: CatalogKind,
    origin: string,
  ): Promise<Result<ResolvedNode | null, DatabaseUnavailable>> {
    if (kind === "skill") {
      const found = await this.repos.skill.findByOrigin(origin);
      if (found.isErr()) return err(found.error);
      const skill = found.value;
      if (skill === undefined) return ok(null);
      const skills = await this.skillOrigins(skill.dependencyRefs.skills);
      if (skills.isErr()) return err(skills.error);
      const mcps = await this.mcpOrigins(skill.dependencyRefs.mcps);
      if (mcps.isErr()) return err(mcps.error);
      return ok({
        kind,
        origin,
        fqn: skill.fqn,
        version: skill.version,
        content: "",
        dependencyRefs: { skills: skills.value, mcps: mcps.value, agents: [] },
      });
    }
    if (kind === "agent") {
      const found = await this.repos.agent.findByOrigin(origin);
      if (found.isErr()) return err(found.error);
      const agent = found.value;
      if (agent === undefined) return ok(null);
      const skills = await this.skillOrigins(agent.dependencyRefs.skills);
      if (skills.isErr()) return err(skills.error);
      const mcps = await this.mcpOrigins(agent.dependencyRefs.mcps);
      if (mcps.isErr()) return err(mcps.error);
      const agents = await this.agentOrigins(agent.dependencyRefs.agents);
      if (agents.isErr()) return err(agents.error);
      return ok({
        kind,
        origin,
        fqn: agent.fqn,
        version: agent.version,
        content: "",
        dependencyRefs: { skills: skills.value, mcps: mcps.value, agents: agents.value },
      });
    }
    const found = await this.repos.mcp.findByOrigin(origin);
    if (found.isErr()) return err(found.error);
    const mcp = found.value;
    if (mcp === undefined) return ok(null);
    return ok({
      kind,
      origin,
      fqn: mcp.fqn,
      version: "",
      content: mcp.spec,
      dependencyRefs: EMPTY_DEP_REFS,
    });
  }

  private async skillOrigins(
    fqns: readonly string[],
  ): Promise<Result<string[], DatabaseUnavailable>> {
    const out: string[] = [];
    for (const fqn of fqns) {
      const found = await this.repos.skill.findByFqn(fqn as SkillFqn);
      if (found.isErr()) return err(found.error);
      out.push(found.value === undefined ? fqn : found.value.origin);
    }
    return ok(out);
  }

  private async mcpOrigins(
    fqns: readonly string[],
  ): Promise<Result<string[], DatabaseUnavailable>> {
    const out: string[] = [];
    for (const fqn of fqns) {
      const found = await this.repos.mcp.findByFqn(fqn as McpFqn);
      if (found.isErr()) return err(found.error);
      out.push(found.value === undefined ? fqn : found.value.origin);
    }
    return ok(out);
  }

  private async agentOrigins(
    fqns: readonly string[],
  ): Promise<Result<string[], DatabaseUnavailable>> {
    const out: string[] = [];
    for (const fqn of fqns) {
      const found = await this.repos.agent.findByFqn(fqn as AgentFqn);
      if (found.isErr()) return err(found.error);
      out.push(found.value === undefined ? fqn : found.value.origin);
    }
    return ok(out);
  }
}
