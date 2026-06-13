#!/usr/bin/env node
// Cross-platform watchdog body for the `dispatch-watchdog` skill.
//
// Polls `glyph <kind> show <id> --json` on a fixed cadence and exits when
// status reaches a terminal value (`succeeded`, `failed`, `cancelled`).
// Designed to be spawned via the runtime's `mode:async + detach:true`
// primitive (Pattern 4 in SKILL.md) so the runtime can deliver a
// completion notification back to the orchestrator session on exit.
//
// Usage: node watchdog.mjs <task|workflow> <id> <abs-log-path> [poll-sec=60] [max-loops=240]

import { execSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";

const [, , kind, id, logPath, pollStr = "60", maxStr = "240"] = process.argv;

if (!kind || !["task", "workflow"].includes(kind) || !id || !logPath) {
  console.error("usage: node watchdog.mjs <task|workflow> <id> <abs-log-path> [poll-sec=60] [max-loops=240]");
  process.exit(2);
}

// Defence-in-depth: ids are server-controlled (format: YYYYMMDD-<8 hex>),
// but the value flows into a shell-invoked `execSync` below. Reject anything
// outside `[A-Za-z0-9-]` so the command string can never carry metacharacters.
if (!/^[A-Za-z0-9-]+$/.test(id)) {
  console.error(`refusing to poll id with unexpected characters: ${id}`);
  process.exit(2);
}

const pollMs = Number(pollStr) * 1000;
const maxLoops = Number(maxStr);
if (!Number.isFinite(pollMs) || pollMs <= 0 || !Number.isFinite(maxLoops) || maxLoops <= 0) {
  console.error(`invalid numeric args: poll-sec=${pollStr} max-loops=${maxStr}`);
  process.exit(2);
}

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

// Caller contract item 4: a start marker MUST be durable within 5s of spawn.
// Synchronous write before the poll loop guarantees it.
writeFileSync(logPath, `${new Date().toISOString()} watchdog started for ${id}\n`);

for (let i = 0; i < maxLoops; i++) {
  // Sleep first, then poll. Item 5 expects the first status line within
  // roughly 2× pollSec — sleep-then-poll keeps the cadence regular and
  // avoids a thundering-herd first poll the instant the watchdog spawns.
  await new Promise((r) => setTimeout(r, pollMs));

  let status = "";
  try {
    // `execSync` with a string command routes through the OS shell, which
    // on Windows correctly resolves the `glyph.cmd` npm shim. `execFileSync`
    // throws EINVAL on Windows + Node 22+ for `.cmd`/`.bat` (CVE-2024-27980
    // hardening). The id arg is regex-validated above so the shell call is
    // not an injection vector.
    const raw = execSync(`glyph ${kind} show ${id} --json`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    // `JSON.parse` indexes the top-level `status` field directly — robust
    // against long string values, backslash escapes (e.g. Windows paths in
    // briefs), and any `"status": "..."` substrings that happen to appear
    // inside nested string content like a workflow's `details` field.
    const parsed = JSON.parse(raw);
    status = typeof parsed?.status === "string" ? parsed.status : "";
  } catch (e) {
    status = "";
    const msg = String(e?.message ?? e).replace(/\s+/g, " ").slice(0, 200);
    appendFileSync(logPath, `${new Date().toISOString()} poll-error: ${msg}\n`);
  }

  appendFileSync(logPath, `${new Date().toISOString()} status=${status}\n`);

  if (TERMINAL.has(status)) {
    process.exit(0);
  }
}

appendFileSync(logPath, `${new Date().toISOString()} max-loops-exceeded\n`);
process.exit(1);
