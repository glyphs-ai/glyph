import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { InstallSkillUseCase } from "../../../src/application/skill/install-skill.js";
import { SkillEntity, type SkillEntityArgs } from "../../../src/domain/skill-entity.js";
import { SkillFqnSchema } from "../../../src/domain/skill-fqn.js";
import { SkillManifest } from "../../../src/domain/skill-manifest.js";
import type { SkillRepository } from "../../../src/domain/skill-repository.js";
import type { Source } from "../../../src/domain/source.js";

const SKILL_ID = SkillFqnSchema.parse("public/tool-use");
const ORIGIN = "file:///skills/tool-use";
const OTHER_ORIGIN = "file:///skills/other";
const databaseError = { type: "DatabaseUnavailable", cause: new Error("db down") } as const;
const FILES = new Map([["SKILL.md", Buffer.from("# tool-use")]]);

function skill(overrides: Partial<SkillEntityArgs> = {}): SkillEntity {
  return new SkillEntity({
    fqn: SKILL_ID,
    origin: ORIGIN,
    description: "Tool use",
    version: "1.0.0",
    prereqs: "set GITHUB_TOKEN",
    prereqsAck: false,
    dependencyRefs: { skills: [], mcps: [] },
    installedAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
    ...overrides,
  });
}

function manifest(
  args: { prereqs?: string; dependencies?: { skills?: string[]; mcps?: string[] } } = {},
): SkillManifest {
  return SkillManifest.create({
    name: "tool-use",
    scope: "public",
    description: "Tool use",
    version: "1.0.0",
    ...(args.prereqs !== undefined ? { prereqs: args.prereqs } : {}),
    ...(args.dependencies !== undefined ? { dependencies: args.dependencies } : {}),
  })._unsafeUnwrap();
}

let skillSource: MockProxy<Source<SkillManifest>>;
let skillRepo: MockProxy<SkillRepository>;
let useCase: InstallSkillUseCase;

beforeEach(() => {
  skillSource = mock<Source<SkillManifest>>();
  skillRepo = mock<SkillRepository>();
  skillSource.fetch.mockReturnValue(
    okAsync({ manifest: manifest({ prereqs: "set GITHUB_TOKEN" }), files: FILES }),
  );
  skillRepo.get.mockReturnValue(errAsync({ type: "SkillNotFound", fqn: SKILL_ID }));
  skillRepo.save.mockReturnValue(okAsync(undefined));
  useCase = new InstallSkillUseCase({ skillSource, skillRepo });
});

describe("InstallSkillUseCase — mutation paths", () => {
  it("fetches a new skill, saves entity plus files, and returns install status", async () => {
    const res = await useCase.execute({ origin: ORIGIN, dependencyRefs: { skills: [], mcps: [] } });
    expect(res._unsafeUnwrap()).toEqual({
      id: SKILL_ID,
      origin: ORIGIN,
      prereqs: "set GITHUB_TOKEN",
      prereqsAck: false,
    });
    expect(skillSource.fetch).toHaveBeenCalledWith(ORIGIN);
    expect(skillRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        fqn: SKILL_ID,
        origin: ORIGIN,
        description: "Tool use",
        version: "1.0.0",
        prereqs: "set GITHUB_TOKEN",
        dependencyRefs: { skills: [], mcps: [] },
      }),
      FILES,
    );
  });

  it("omits blank prereqs and auto-acknowledges when no prereqs exist", async () => {
    skillSource.fetch.mockReturnValue(okAsync({ manifest: manifest(), files: FILES }));
    const res = await useCase.execute({ origin: ORIGIN, dependencyRefs: { skills: [], mcps: [] } });
    expect(res._unsafeUnwrap()).toEqual({ id: SKILL_ID, origin: ORIGIN, prereqsAck: true });
  });

  it("uses request dependencyRefs instead of manifest dependencyRefs", async () => {
    skillSource.fetch.mockReturnValue(
      okAsync({
        manifest: manifest({ dependencies: { skills: ["public/from-manifest"] } }),
        files: FILES,
      }),
    );
    await useCase.execute({
      origin: ORIGIN,
      dependencyRefs: { skills: ["public/from-request"], mcps: ["azure/mcp"] },
    });
    expect(skillRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        dependencyRefs: { skills: ["public/from-request"], mcps: ["azure/mcp"] },
      }),
      expect.any(Map),
    );
  });

  it("carries prereqs acknowledgement across same-origin reinstall when prereqs match", async () => {
    skillRepo.get.mockReturnValue(okAsync(skill({ prereqsAck: true })));
    const res = await useCase.execute({ origin: ORIGIN, dependencyRefs: { skills: [], mcps: [] } });
    expect(res._unsafeUnwrap().prereqsAck).toBe(true);
  });

  it("resets carried acknowledgement when prereqs change", async () => {
    skillRepo.get.mockReturnValue(okAsync(skill({ prereqs: "old", prereqsAck: true })));
    const res = await useCase.execute({ origin: ORIGIN, dependencyRefs: { skills: [], mcps: [] } });
    expect(res._unsafeUnwrap().prereqsAck).toBe(false);
  });
});

describe("InstallSkillUseCase — error channel", () => {
  it("propagates SourceError from skillSource.fetch", async () => {
    const sourceError = { type: "OriginInvalid", origin: ORIGIN, reason: "bad" } as const;
    skillSource.fetch.mockReturnValue(errAsync(sourceError));
    const res = await useCase.execute({ origin: ORIGIN, dependencyRefs: { skills: [], mcps: [] } });
    expect(res._unsafeUnwrapErr()).toBe(sourceError);
    expect(skillRepo.save).not.toHaveBeenCalled();
  });

  it("returns SkillOriginConflict when an existing skill has another origin", async () => {
    skillRepo.get.mockReturnValue(okAsync(skill({ origin: OTHER_ORIGIN })));
    const res = await useCase.execute({ origin: ORIGIN, dependencyRefs: { skills: [], mcps: [] } });
    expect(res._unsafeUnwrapErr()).toEqual({
      type: "SkillOriginConflict",
      fqn: SKILL_ID,
      existingOrigin: OTHER_ORIGIN,
      attemptedOrigin: ORIGIN,
    });
    expect(skillRepo.save).not.toHaveBeenCalled();
  });

  it("propagates DatabaseUnavailable from repo.get", async () => {
    skillRepo.get.mockReturnValue(errAsync(databaseError));
    const res = await useCase.execute({ origin: ORIGIN, dependencyRefs: { skills: [], mcps: [] } });
    expect(res._unsafeUnwrapErr()).toBe(databaseError);
  });

  it("propagates DatabaseUnavailable from repo.save", async () => {
    skillRepo.save.mockReturnValue(errAsync(databaseError));
    const res = await useCase.execute({ origin: ORIGIN, dependencyRefs: { skills: [], mcps: [] } });
    expect(res._unsafeUnwrapErr()).toBe(databaseError);
  });
});
