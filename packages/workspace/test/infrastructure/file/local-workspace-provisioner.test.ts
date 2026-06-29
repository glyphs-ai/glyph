import { existsSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  it("creates sessions/, tasks/, and workflows/ under workspaceDir", async () => {
    const wsDir = path.join(scratch, "ws-a");
    const res = await provisioner.provision(wsDir);
    expect(res.isOk()).toBe(true);

    for (const sub of ["sessions", "tasks", "workflows"]) {
      const p = path.join(wsDir, sub);
      expect(existsSync(p)).toBe(true);
      expect(statSync(p).isDirectory()).toBe(true);
    }
  });

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

describe("LocalWorkspaceProvisioner.teardown", () => {
  it("removes sessions/, tasks/, and workflows/ (leaves workspaceDir in place)", async () => {
    const wsDir = path.join(scratch, "ws-t1");
    await provisioner.provision(wsDir);
    // Each managed subdirectory contains a file before teardown.
    for (const sub of ["sessions", "tasks", "workflows"]) {
      await writeFile(path.join(wsDir, sub, "x.txt"), "x");
    }

    const res = await provisioner.teardown(wsDir);
    expect(res.isOk()).toBe(true);

    for (const sub of ["sessions", "tasks", "workflows"]) {
      expect(existsSync(path.join(wsDir, sub))).toBe(false);
    }
    // Teardown removes managed subdirectories, not the workspace root.
    expect(existsSync(wsDir)).toBe(true);
  });

  it("preserves unrelated files at the workspaceDir root", async () => {
    const wsDir = path.join(scratch, "ws-t2");
    await provisioner.provision(wsDir);
    const sentinel = path.join(wsDir, "unrelated.txt");
    await writeFile(sentinel, "operator-content");

    await provisioner.teardown(wsDir);
    expect(existsSync(sentinel)).toBe(true);
  });

  it("is idempotent on a never-provisioned workspaceDir (rm force=true)", async () => {
    const wsDir = path.join(scratch, "ws-t3");
    await mkdir(wsDir, { recursive: true });
    // Managed subdirectories do not exist before teardown.
    const res = await provisioner.teardown(wsDir);
    expect(res.isOk()).toBe(true);
  });

  it("is idempotent across repeated teardown calls", async () => {
    const wsDir = path.join(scratch, "ws-t4");
    await provisioner.provision(wsDir);
    await provisioner.teardown(wsDir);
    const res = await provisioner.teardown(wsDir);
    expect(res.isOk()).toBe(true);
  });
});
