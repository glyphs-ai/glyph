import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { InstallAgentUseCase } from "../../../src/application/agent/install-agent.js";
import { AgentEntity, type AgentEntityArgs } from "../../../src/domain/agent-entity.js";
import { AgentFqnSchema } from "../../../src/domain/agent-fqn.js";
import { AgentManifest } from "../../../src/domain/agent-manifest.js";
import type { AgentRepository } from "../../../src/domain/agent-repository.js";
import { McpFqnSchema } from "../../../src/domain/mcp-fqn.js";
import { SkillFqnSchema } from "../../../src/domain/skill-fqn.js";
import type { Source } from "../../../src/domain/source.js";

const AGENT_ID = AgentFqnSchema.parse("public/triage");
const AGENT_ORIGIN = "file:///catalog/agents/triage";
const asAgentFqn = (value: string) => AgentFqnSchema.parse(value);
const asSkillFqn = (value: string) => SkillFqnSchema.parse(value);
const asMcpFqn = (value: string) => McpFqnSchema.parse(value);

function agentEntity(overrides: Partial<AgentEntityArgs> = {}): AgentEntity {
  return new AgentEntity({
    fqn: AGENT_ID,
    origin: AGENT_ORIGIN,
    description: "Triage agent",
    version: "1.0.0",
    prereqs: undefined,
    prereqsAck: true,
    disabledByUser: false,
    dependencyRefs: { skills: [], mcps: [], agents: [] },
    installedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  });
}

function agentManifest(
  opts: {
    readonly description?: string;
    readonly version?: string;
    readonly prereqs?: string;
    readonly dependencyRefs?: {
      readonly skills: readonly string[];
      readonly mcps: readonly string[];
      readonly agents: readonly string[];
    };
    readonly files?: ReadonlyMap<string, Buffer>;
  } = {},
): AgentManifest {
  return AgentManifest.create(
    {
      name: "triage",
      scope: "public",
      description: opts.description ?? "Triage agent",
      version: opts.version ?? "1.0.0",
      ...(opts.prereqs !== undefined ? { prereqs: opts.prereqs } : {}),
      ...(opts.dependencyRefs !== undefined
        ? {
            dependencies: {
              skills: [...opts.dependencyRefs.skills],
              mcps: [...opts.dependencyRefs.mcps],
              agents: [...opts.dependencyRefs.agents],
            },
          }
        : {}),
    },
    opts.files ?? new Map([["AGENTS.md", Buffer.from("# triage")]]),
  )._unsafeUnwrap();
}

let agentSource: MockProxy<Source<AgentManifest>>;
let agentRepo: MockProxy<AgentRepository>;
let useCase: InstallAgentUseCase;

beforeEach(() => {
  agentSource = mock<Source<AgentManifest>>();
  agentRepo = mock<AgentRepository>();
  agentRepo.get.mockReturnValue(errAsync({ type: "AgentNotFound", fqn: AGENT_ID }));
  agentRepo.save.mockReturnValue(okAsync(undefined));
  useCase = new InstallAgentUseCase({ agentSource, agentRepo });
});

describe("InstallAgentUseCase — happy path", () => {
  it("loads a manifest, creates a new agent, saves files, and returns the install DTO", async () => {
    const files = new Map([["AGENTS.md", Buffer.from("# triage")]]);
    agentSource.load.mockReturnValue(okAsync(agentManifest({ prereqs: "Set token", files })));

    const dto = (
      await useCase.execute({
        origin: AGENT_ORIGIN,
        dependencyRefs: {
          skills: [asSkillFqn("public/tool-use")],
          mcps: [asMcpFqn("azure/mcp")],
          agents: [asAgentFqn("public/worker")],
        },
      })
    )._unsafeUnwrap();

    const saved = agentRepo.save.mock.calls[0]?.[0];
    expect(agentSource.load).toHaveBeenCalledWith(AGENT_ORIGIN);
    expect(saved).toMatchObject({
      fqn: AGENT_ID,
      origin: AGENT_ORIGIN,
      description: "Triage agent",
      version: "1.0.0",
      prereqs: "Set token",
    });
    expect(agentRepo.save.mock.calls[0]?.[1]).toBe(files);
    expect(dto).toEqual({
      id: AGENT_ID,
      description: "Triage agent",
      version: "1.0.0",
      prereqs: "Set token",
      prereqsAck: false,
      disabledByUser: false,
      skills: ["public/tool-use"],
      mcps: ["azure/mcp"],
      agents: ["public/worker"],
    });
  });

  it("uses request dependencyRefs instead of manifest dependencyRefs when provided", async () => {
    agentSource.load.mockReturnValue(
      okAsync(
        agentManifest({
          dependencyRefs: { skills: [asSkillFqn("public/manifest")], mcps: [], agents: [] },
        }),
      ),
    );

    const dto = (
      await useCase.execute({
        origin: AGENT_ORIGIN,
        dependencyRefs: { skills: ["public/request"], mcps: ["azure/mcp"], agents: [] },
      })
    )._unsafeUnwrap();

    expect(dto.skills).toEqual(["public/request"]);
    expect(dto.mcps).toEqual(["azure/mcp"]);
  });

  it("carries prereq acknowledgement and disabled state across same-origin reinstall", async () => {
    agentSource.load.mockReturnValue(okAsync(agentManifest({ prereqs: "Same prereq" })));
    agentRepo.get.mockReturnValue(
      okAsync(
        agentEntity({
          origin: AGENT_ORIGIN,
          prereqs: "Same prereq",
          prereqsAck: true,
          disabledByUser: true,
        }),
      ),
    );

    const dto = (
      await useCase.execute({
        origin: AGENT_ORIGIN,
        dependencyRefs: { skills: [], mcps: [], agents: [] },
      })
    )._unsafeUnwrap();

    expect(dto.prereqsAck).toBe(true);
    expect(dto.disabledByUser).toBe(true);
  });

  it("resets prereq acknowledgement when prereqs change on reinstall", async () => {
    agentSource.load.mockReturnValue(okAsync(agentManifest({ prereqs: "New prereq" })));
    agentRepo.get.mockReturnValue(
      okAsync(agentEntity({ origin: AGENT_ORIGIN, prereqs: "Old prereq", prereqsAck: true })),
    );

    const dto = (
      await useCase.execute({
        origin: AGENT_ORIGIN,
        dependencyRefs: { skills: [], mcps: [], agents: [] },
      })
    )._unsafeUnwrap();

    expect(dto.prereqsAck).toBe(false);
  });
});

describe("InstallAgentUseCase — error channel", () => {
  it("propagates source errors and does not save", async () => {
    agentSource.load.mockReturnValue(
      errAsync({ type: "OriginInvalid", origin: AGENT_ORIGIN, reason: "bad scheme" }),
    );

    const res = await useCase.execute({
      origin: AGENT_ORIGIN,
      dependencyRefs: { skills: [], mcps: [], agents: [] },
    });

    expect(res._unsafeUnwrapErr()).toEqual({
      type: "OriginInvalid",
      origin: AGENT_ORIGIN,
      reason: "bad scheme",
    });
    expect(agentRepo.save).not.toHaveBeenCalled();
  });

  it("returns AgentOriginConflict when the fqn is installed from another origin", async () => {
    agentSource.load.mockReturnValue(okAsync(agentManifest()));
    agentRepo.get.mockReturnValue(okAsync(agentEntity({ origin: "file:///other" })));

    const res = await useCase.execute({
      origin: AGENT_ORIGIN,
      dependencyRefs: { skills: [], mcps: [], agents: [] },
    });

    expect(res._unsafeUnwrapErr()).toEqual({
      type: "AgentOriginConflict",
      fqn: AGENT_ID,
      existingOrigin: "file:///other",
      attemptedOrigin: AGENT_ORIGIN,
    });
    expect(agentRepo.save).not.toHaveBeenCalled();
  });

  it("propagates DatabaseUnavailable from repo.get", async () => {
    const cause = new Error("disk");
    agentSource.load.mockReturnValue(okAsync(agentManifest()));
    agentRepo.get.mockReturnValue(errAsync({ type: "DatabaseUnavailable", cause }));

    const res = await useCase.execute({
      origin: AGENT_ORIGIN,
      dependencyRefs: { skills: [], mcps: [], agents: [] },
    });

    expect(res._unsafeUnwrapErr()).toEqual({ type: "DatabaseUnavailable", cause });
  });

  it("propagates DatabaseUnavailable from repo.save", async () => {
    const cause = new Error("disk");
    agentSource.load.mockReturnValue(okAsync(agentManifest()));
    agentRepo.save.mockReturnValue(errAsync({ type: "DatabaseUnavailable", cause }));

    const res = await useCase.execute({
      origin: AGENT_ORIGIN,
      dependencyRefs: { skills: [], mcps: [], agents: [] },
    });

    expect(res._unsafeUnwrapErr()).toEqual({ type: "DatabaseUnavailable", cause });
  });
});
