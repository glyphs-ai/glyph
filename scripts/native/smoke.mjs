/**
 * End-to-end smoke for the SEA artefact. PR1's verification floor:
 * proves the externalised native deps (`better-sqlite3`, `pino`,
 * `@github/copilot-sdk`) load, and proves the CLI ↔ server HTTP wire
 * functions when both ends run from inside the same binary.
 *
 * Steps (sequential; first failure aborts the run):
 *   1. `glyph --version` matches the version baked into the
 *      embedded `package.json`. Catches a missing version-reader
 *      patch in the bootstrap.
 *   2. Background-spawn `glyph serve --no-serve-static` against a
 *      fresh `GLYPH_HOME`. We invoke `serve` directly, NOT
 *      `glyph start` — `start` would self-spawn the SEA binary as a
 *      JS file (`spawn(process.execPath, [process.argv[1], "serve",
 *      ...])` reduces to `spawn(<sea>, [<sea>, "serve", ...])` and
 *      Node-as-SEA would try to interpret argv[1] as a script).
 *      `serve` runs in the foreground, which is exactly what we want
 *      to keep the smoke deterministic. PR2 will revisit start/stop
 *      once the orchestrator is SEA-aware.
 *   3. Poll `/api/health` until 200 OK or timeout. Catches a broken
 *      server boot — most often the copilot-sdk preflight failing.
 *   4. `glyph health` via HTTP. Catches a broken CLI HTTP path.
 *   5. `glyph workspace add` + `glyph workspace list`. Catches a
 *      broken better-sqlite3 binding (the workspace table is the
 *      first write the server performs).
 *   6. `glyph catalog skill list` against the new workspace. Catches
 *      a broken pino path (cataloguer logs heavily on the
 *      workspace's first read).
 *   7. Cleanup: SIGTERM the serve child, await exit, remove temp dirs.
 *
 * The smoke writes a single line per assertion to keep CI logs scannable.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { commandForExecFile, fail, run, tryRun } from "./exec.mjs";
import { nativeBinPath, repoRoot, targetTriple } from "./paths.mjs";

const TARGET = targetTriple();
const BIN = nativeBinPath(TARGET);

if (!existsSync(BIN)) {
  fail(`SEA binary missing at ${BIN}. Run \`node scripts/native/build.mjs\` first.`);
}

const tmpRoot = await mkdtemp(join(tmpdir(), "glyph-sea-smoke-"));
const home = join(tmpRoot, "home");
const seaHome = join(tmpRoot, "sea-materialize");
const port = await pickFreePort();
const baseUrl = `http://127.0.0.1:${port}`;

const env = {
  ...process.env,
  GLYPH_HOME: home,
  GLYPH_SEA_HOME: seaHome,
  GLYPH_SERVER: baseUrl,
};

let serverProc;
try {
  await stepVersion();
  serverProc = await stepStartServer();
  await stepWaitForHealth();
  await stepHealthCli();
  const workspaceId = await stepWorkspaceAdd();
  await stepWorkspaceList(workspaceId);
  await stepCatalogSkillList(workspaceId);
  console.log("==> smoke: all assertions passed");
} catch (err) {
  console.error(`==> smoke: FAIL — ${err && err.message ? err.message : err}`);
  process.exitCode = 1;
} finally {
  await teardown(serverProc);
  await tryRun("rm", ["-rf", tmpRoot]);
}

async function stepVersion() {
  const expected = JSON.parse(
    await readFile(resolve(repoRoot, "package.json"), "utf-8"),
  ).version;
  const { stdout } = await run(BIN, ["--version"], { env, captureStdout: true });
  const got = stdout.trim();
  if (got !== expected) {
    fail(`version mismatch: expected ${expected}, got ${got}`);
  }
  console.log(`==> smoke step 1/6: version = ${got}`);
}

async function stepStartServer() {
  const args = ["serve", "--no-serve-static", "--host", "127.0.0.1", "--port", String(port)];
  console.log(`==> smoke step 2/6: spawn ${commandForExecFile(BIN, args)}`);
  const child = spawn(BIN, args, {
    env,
    stdio: ["ignore", "inherit", "inherit"],
    detached: false,
  });
  child.on("error", (err) => {
    console.error(`==> serve spawn error: ${err && err.message ? err.message : err}`);
  });
  return child;
}

async function stepWaitForHealth() {
  const deadline = Date.now() + 45_000;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`${baseUrl}/api/health`);
      if (resp.ok) {
        console.log("==> smoke step 3/6: /api/health 200 OK");
        return;
      }
      lastErr = new Error(`http ${resp.status}`);
    } catch (err) {
      lastErr = err;
    }
    await delay(500);
  }
  fail(`server never became healthy within 45s: ${lastErr ? lastErr.message : "unknown"}`);
}

async function stepHealthCli() {
  await run(BIN, ["health"], { env });
  console.log("==> smoke step 4/6: `glyph health` exit 0");
}

async function stepWorkspaceAdd() {
  const { stdout } = await run(
    BIN,
    ["workspace", "add", "--name", "smoke-test", "--json"],
    { env, captureStdout: true },
  );
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    fail(`workspace add did not return JSON: ${err.message}\n${stdout}`);
  }
  const id = parsed?.id ?? parsed?.workspace?.id ?? parsed?.data?.id;
  if (typeof id !== "string" || id.length === 0) {
    fail(`workspace add JSON has no id field: ${JSON.stringify(parsed)}`);
  }
  console.log(`==> smoke step 5/6: workspace add ${id}`);
  return id;
}

async function stepWorkspaceList(expectedId) {
  const { stdout } = await run(
    BIN,
    ["workspace", "list", "--json"],
    { env, captureStdout: true },
  );
  if (!stdout.includes(expectedId)) {
    fail(`workspace list does not contain ${expectedId}:\n${stdout}`);
  }
  console.log(`==> smoke step 5/6: workspace list includes ${expectedId}`);
}

async function stepCatalogSkillList(workspaceId) {
  await run(BIN, ["catalog", "skill", "list", "--workspace", workspaceId], { env });
  console.log("==> smoke step 6/6: `glyph catalog skill list` exit 0");
}

async function teardown(child) {
  if (!child) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  // Give the server up to 5s to drain; SIGKILL if it lingers.
  const start = Date.now();
  while (Date.now() - start < 5_000) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await delay(100);
  }
  try {
    child.kill("SIGKILL");
  } catch {
    /* ignore */
  }
}

function pickFreePort() {
  return new Promise((resolveFn, rejectFn) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", rejectFn);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (typeof addr === "object" && addr !== null) {
        const p = addr.port;
        srv.close(() => resolveFn(p));
      } else {
        rejectFn(new Error("could not pick free port"));
      }
    });
  });
}
