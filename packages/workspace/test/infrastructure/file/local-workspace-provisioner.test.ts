import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalWorkspaceProvisioner } from "../../../src/infrastructure/file/local-workspace-provisioner.js";

let scratch: string;
let provisioner: LocalWorkspaceProvisioner;

beforeEach(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "ws-provisioner-"));
  provisioner = new LocalWorkspaceProvisioner();
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("LocalWorkspaceProvisioner.provision", () => {
  it("creates workspaceDir itself when it does not already exist", async () => {
    const wsDir = path.join(scratch, "nested", "deep", "ws");
    const res = await provisioner.provision(wsDir);
    expect(res.isOk()).toBe(true);
    expect(existsSync(wsDir)).toBe(true);
  });

  it("is idempotent: re-running on an already-provisioned dir is a no-op success", async () => {
    const wsDir = path.join(scratch, "ws-b");
    await provisioner.provision(wsDir);
    const res = await provisioner.provision(wsDir);
    expect(res.isOk()).toBe(true);
  });

  it("returns ProvisioningFailed when mkdir cannot succeed (file at the target path)", async () => {
    const wsDir = path.join(scratch, "ws-c");
    // A regular file blocks creation of the workspace directory.
    await writeFile(wsDir, "block");
    const res = await provisioner.provision(wsDir);
    expect(res.isErr()).toBe(true);
    const err = res._unsafeUnwrapErr();
    expect(err.type).toBe("ProvisioningFailed");
    if (err.type === "ProvisioningFailed") expect(err.workspaceDir).toBe(wsDir);
  });
});
