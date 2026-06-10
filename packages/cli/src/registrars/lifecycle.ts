import type { Command } from "commander";
import { logs } from "../commands/logs.js";
import { type RestartOpts, restart } from "../commands/restart.js";
import { type ServeOpts, serve } from "../commands/serve.js";
import { type StartOpts, start } from "../commands/start.js";
import { status } from "../commands/status.js";
import { stop } from "../commands/stop.js";
import type { Slot } from "./_shared.js";

export function registerLifecycleCommands(program: Command, slot: Slot): void {
  program
    .command("serve")
    .description("Run the glyph server in the foreground")
    .option("-p, --port <port>", "Listen port (env: PORT, default 8787)")
    .option("--host <host>", "Bind host (env: GLYPH_HOST, default 127.0.0.1)")
    .option("--no-serve-static", "Do not serve the dashboard SPA")
    .option("--static-dir <dir>", "Override the dashboard SPA directory")
    .option("--log-level <level>", "Log level (debug | info | warn | error)")
    .option("--log-format <fmt>", "Log format on stdout (pretty | json)")
    .action(async (opts: Record<string, unknown>) => {
      await serve(parseServeFlags(opts));
    });

  program
    .command("start")
    .description("Start the glyph server as a detached background process")
    .option("-p, --port <port>", "Listen port (env: PORT, default 8787)")
    .option("--host <host>", "Bind host (env: GLYPH_HOST, default 127.0.0.1)")
    .option("--no-serve-static", "Do not serve the dashboard SPA")
    .option("--static-dir <dir>", "Override the dashboard SPA directory")
    .option("--log-level <level>", "Log level (debug | info | warn | error)")
    .option("--log-format <fmt>", "Log format on stdout (pretty | json)")
    .action(async (opts: Record<string, unknown>) => {
      slot.result = await start(parseServeFlags(opts) as StartOpts);
    });

  program
    .command("stop")
    .description("Stop a running glyph server")
    .action(async () => {
      slot.result = await stop();
    });

  program
    .command("restart")
    .description("Stop and start the glyph server")
    .option("-p, --port <port>", "Listen port (env: PORT, default 8787)")
    .option("--host <host>", "Bind host (env: GLYPH_HOST, default 127.0.0.1)")
    .option("--no-serve-static", "Do not serve the dashboard SPA")
    .option("--static-dir <dir>", "Override the dashboard SPA directory")
    .option("--log-level <level>", "Log level (debug | info | warn | error)")
    .option("--log-format <fmt>", "Log format on stdout (pretty | json)")
    .action(async (opts: Record<string, unknown>) => {
      slot.result = await restart(parseServeFlags(opts) as RestartOpts);
    });

  program
    .command("status")
    .description("Print whether the glyph server is running")
    .option("--json", "Emit a JSON payload instead of a one-line summary")
    .action(async (opts: Record<string, unknown>) => {
      slot.result = await status({ json: opts.json === true });
    });

  program
    .command("logs")
    .description("Print the server log file")
    .option("-f, --follow", "Follow the log as it grows (Ctrl-C to stop)")
    .action(async (opts: Record<string, unknown>) => {
      slot.result = await logs({ follow: opts.follow === true });
    });
}

function parseServeFlags(opts: Record<string, unknown>): ServeOpts {
  type Mutable = { -readonly [K in keyof ServeOpts]: ServeOpts[K] };
  const out: Mutable = {};
  const port = opts.port;
  if (typeof port === "number") out.port = port;
  else if (typeof port === "string" && port !== "") out.port = Number(port);
  if (typeof opts.host === "string") out.host = opts.host;
  if (opts.serveStatic === false) out.serveStatic = false;
  if (typeof opts.staticDir === "string") out.staticDir = opts.staticDir;
  const level = opts.logLevel;
  if (level === "debug" || level === "info" || level === "warn" || level === "error") {
    out.logLevel = level;
  }
  const fmt = opts.logFormat;
  if (fmt === "pretty" || fmt === "json") out.logFormat = fmt;
  return out;
}
