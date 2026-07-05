/**
 * Use case: walk the UPSTREAM source graph from a root origin and return the
 * deduped reachable graph (one node per origin + verbatim dep edges). Always
 * fetches every node — no install short-circuit — so callers can spot version
 * churn. Cycles and source failures become `graph.conflicts`, never errors;
 * the only error channel is unused (sources translate IO faults to conflicts).
 */

import { ResultAsync } from "neverthrow";
import { z } from "zod";
import type { AgentManifest } from "../../domain/agent-manifest.js";
import { type CatalogKind, CatalogKindSchema } from "../../domain/catalog-kind.js";
import type { McpManifest } from "../../domain/mcp-manifest.js";
import type { SkillManifest } from "../../domain/skill-manifest.js";
import type { Source, SourceError } from "../../domain/source.js";
import type { UseCase, UseCaseResult } from "../use-case.js";
import {
  type CatalogConflict,
  EMPTY_DEP_REFS,
  type ResolvedGraph,
  ResolvedGraphSchema,
  type ResolvedNode,
} from "./dependency-graph.js";

export const GetUpstreamTreeRequestSchema = z.object({
  kind: CatalogKindSchema,
  origin: z.string(),
});
export type GetUpstreamTreeRequest = z.infer<typeof GetUpstreamTreeRequestSchema>;

export const GetUpstreamTreeResponseSchema = ResolvedGraphSchema;
export type GetUpstreamTreeResponse = z.infer<typeof GetUpstreamTreeResponseSchema>;

export type GetUpstreamTreeError = never;

export interface UpstreamSources {
  readonly skill: Source<SkillManifest>;
  readonly agent: Source<AgentManifest>;
  readonly mcp: Source<McpManifest>;
}

export class GetUpstreamTreeUseCase
  implements UseCase<GetUpstreamTreeRequest, GetUpstreamTreeResponse, GetUpstreamTreeError>
{
  constructor(private readonly sources: UpstreamSources) {}

  execute(
    request: GetUpstreamTreeRequest,
  ): UseCaseResult<GetUpstreamTreeResponse, GetUpstreamTreeError> {
    return ResultAsync.fromSafePromise(this.walk(request));
  }

  private async walk(root: GetUpstreamTreeRequest): Promise<ResolvedGraph> {
    const nodes = new Map<string, ResolvedNode>();
    const conflicts: CatalogConflict[] = [];
    const seen = new Set<string>();

    // BFS: fetch each level of the dep graph in parallel. `seen` ensures
    // every origin is fetched at most once (dedup + cycle-safe).
    type FrontierEntry = { kind: CatalogKind; origin: string };
    let frontier: FrontierEntry[] = [{ kind: root.kind, origin: root.origin }];
    seen.add(root.origin);

    while (frontier.length > 0) {
      const results = await Promise.all(
        frontier.map(({ kind, origin }) =>
          this.load(kind, origin).then((result) => ({ origin, result })),
        ),
      );

      const next: FrontierEntry[] = [];
      for (const { origin, result } of results) {
        if ("reason" in result) {
          conflicts.push(result);
          continue;
        }
        nodes.set(origin, result);
        for (const o of result.dependencyRefs.mcps) {
          if (!seen.has(o)) {
            seen.add(o);
            next.push({ kind: "mcp", origin: o });
          }
        }
        for (const o of result.dependencyRefs.skills) {
          if (!seen.has(o)) {
            seen.add(o);
            next.push({ kind: "skill", origin: o });
          }
        }
        for (const o of result.dependencyRefs.agents) {
          if (!seen.has(o)) {
            seen.add(o);
            next.push({ kind: "agent", origin: o });
          }
        }
      }
      frontier = next;
    }

    return { nodes: [...nodes.values()], conflicts };
  }

  private async load(kind: CatalogKind, origin: string): Promise<ResolvedNode | CatalogConflict> {
    const onErr = (cause: SourceError): CatalogConflict => ({
      kind,
      origin,
      fqn: null,
      reason:
        cause.type === "ManifestInvalid"
          ? { kind: "parse-failed", cause: new Error(cause.reason) }
          : {
              kind: "fetch-failed",
              cause: cause.type === "OriginInvalid" ? new Error(cause.reason) : cause.cause,
            },
    });
    if (kind === "skill") {
      return (await this.sources.skill.load(origin)).match(
        (m) => ({
          kind,
          origin,
          fqn: `${m.scope}/${m.name}`,
          version: m.version,
          content: "",
          dependencyRefs: {
            skills: [...m.dependencyRefs.skills],
            mcps: [...m.dependencyRefs.mcps],
            agents: [],
          },
        }),
        onErr,
      );
    }
    if (kind === "agent") {
      return (await this.sources.agent.load(origin)).match(
        (m) => ({
          kind,
          origin,
          fqn: `${m.scope}/${m.name}`,
          version: m.version,
          content: "",
          dependencyRefs: {
            skills: [...m.dependencyRefs.skills],
            mcps: [...m.dependencyRefs.mcps],
            agents: [...m.dependencyRefs.agents],
          },
        }),
        onErr,
      );
    }
    return (await this.sources.mcp.load(origin)).match(
      (m) => ({
        kind,
        origin,
        fqn: m.name,
        version: "",
        content: m.spec,
        dependencyRefs: EMPTY_DEP_REFS,
      }),
      onErr,
    );
  }
}
