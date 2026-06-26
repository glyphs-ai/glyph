import type { Agent, AgentEntry } from "@glyphs-ai/sdk";

const NOW = "2026-05-20T08:00:00.000Z";

function makeAgent(partial: Partial<Agent> & Pick<Agent, "fqn" | "description">): Agent {
  return {
    origin: `https://github.com/glyphs-ai/glyph/tree/main/first-party/agents/${partial.fqn}`,
    version: "1.0.0",
    prereqsAck: true,
    disabledByUser: false,
    installedAt: NOW,
    updatedAt: NOW,
    ...partial,
  } as Agent;
}

/**
 * AgentEntry list mirrors the server's catalog list endpoint
 * (`GET /api/workspaces/:workspaceId/catalog/agents`). Each entry pairs the
 * agent DTO with a status + optional blockedReason, exactly like
 * `@glyphs-ai/catalog`'s `AgentEntry`.
 *
 * One fixture (`official/engineer`) carries a non-empty `dependencies.agents`
 * to exercise the read path through MSW (designer mode + tests that
 * iterate the fixture set). The referenced FQN (`official/reviewer`) is
 * also a fixture entry, so resolve-time validation passes.
 */
export const fixtureAgents: AgentEntry[] = [
  {
    agent: makeAgent({
      fqn: "official/engineer",
      description: "Self-development agent for the glyph control plane.",
      dependencies: {
        agents: [{ fqn: "official/reviewer" }],
      },
    }),
    status: "ready",
    coordEligible: true,
  },
  {
    agent: makeAgent({
      fqn: "official/reviewer",
      description: "Reviews diffs and surfaces high-signal feedback.",
      version: "0.4.2",
    }),
    status: "ready",
    coordEligible: false,
  },
  {
    agent: makeAgent({
      fqn: "official/designer",
      description: "Drives the dashboard via Playwright MCP (designer mode).",
      version: "0.1.0-alpha",
    }),
    status: "blocked",
    blockedReason: {
      needsPrereqsAck: true,
    },
    coordEligible: false,
  },
];
