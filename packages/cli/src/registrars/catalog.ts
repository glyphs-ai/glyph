/**
 * `catalog` subtree registrar. Three resource families — skills,
 * agents, and MCPs — share the same shape of `list / show / install /
 * rm / sync-resolve / sync` commands, with kind-specific optional
 * verbs layered on top. The flat wiring it replaces was 250+ lines of
 * near-identical Commander chains in `index.ts`; here we declare one
 * spec per kind and iterate.
 *
 * Cross-kind asymmetries:
 *   - MCP has no resolve / ack-prereqs.
 *   - Only agent has enable / disable.
 *   - `show --anchor` is present for skills/agents (with different
 *     filename strings — "SKILL.md" vs "AGENTS.md") but absent for MCPs.
 *   - The ident argument is `<name>` for skills/agents and `<fqn>` for
 *     MCPs (and the impl-side opts field name differs too).
 *
 * The ident-name difference is bridged by per-kind action closures
 * stored in the spec, so the loop body stays uniform (no per-kind
 * branching, no casts). Each closure is a one-liner that adapts a
 * uniform `(ident, ...args)` signature into the kind-specific impl's
 * strict opts shape. The closures keep the adaptation type-safe
 * without broad casts in the shared loop.
 *
 * Help-text, option flags, command names, and command-registration
 * ORDER are intentional: Commander preserves registration order in
 * `--help` output, and the tests as well as downstream scripts depend
 * on it.
 */

import type { Command } from "commander";
import {
  catalogAgentAckPrereqs,
  catalogAgentDisable,
  catalogAgentEnable,
  catalogAgentInstall,
  catalogAgentList,
  catalogAgentResolve,
  catalogAgentRm,
  catalogAgentShow,
  catalogAgentSync,
  catalogAgentSyncResolve,
  catalogMcpInstall,
  catalogMcpList,
  catalogMcpRm,
  catalogMcpShow,
  catalogMcpSync,
  catalogMcpSyncResolve,
  catalogOverview,
  catalogSkillAckPrereqs,
  catalogSkillInstall,
  catalogSkillList,
  catalogSkillResolve,
  catalogSkillRm,
  catalogSkillShow,
  catalogSkillSync,
  catalogSkillSyncResolve,
} from "../commands/catalog.js";
import type { CommandResult } from "../result.js";
import {
  optionalString,
  parseWorkspaceFlags,
  pickString,
  type Slot,
  type WorkspaceFlagOpts,
  withWorkspaceFlags,
} from "./_shared.js";

/**
 * Uniform per-action closures. Each entry adapts a kind-specific impl
 * (which uses `name` or `fqn` and slightly different option shapes)
 * into a single uniform call signature, so the loop body below can
 * dispatch without casts or per-kind switches. Optional members map
 * 1:1 to the asymmetries documented at the top of the file.
 *
 * `install` / `resolve` take the user's `--url` / `--file` source via
 * an opaque {@link InstallSourceFlags} bag instead of a positional
 * `origin` — the per-impl closure spreads it into the kind's opts
 * shape. Origin canonicalisation (file: prefix, smuggling guard)
 * happens once inside the impl (`buildInstallOrigin`).
 */
interface InstallSourceFlags {
  readonly url?: string;
  readonly file?: string;
}

interface KindImpls {
  readonly list: (opts: WorkspaceFlagOpts) => Promise<CommandResult>;
  readonly resolve?: (
    source: InstallSourceFlags,
    opts: WorkspaceFlagOpts,
  ) => Promise<CommandResult>;
  readonly show: (
    ident: string,
    anchor: boolean | undefined,
    opts: WorkspaceFlagOpts,
  ) => Promise<CommandResult>;
  readonly install: (source: InstallSourceFlags, opts: WorkspaceFlagOpts) => Promise<CommandResult>;
  readonly rm: (ident: string, opts: WorkspaceFlagOpts) => Promise<CommandResult>;
  readonly syncResolve: (ident: string, opts: WorkspaceFlagOpts) => Promise<CommandResult>;
  readonly sync: (
    ident: string,
    planToken: string,
    opts: WorkspaceFlagOpts,
  ) => Promise<CommandResult>;
  readonly ackPrereqs?: (ident: string, opts: WorkspaceFlagOpts) => Promise<CommandResult>;
  readonly enable?: (ident: string, opts: WorkspaceFlagOpts) => Promise<CommandResult>;
  readonly disable?: (ident: string, opts: WorkspaceFlagOpts) => Promise<CommandResult>;
}

interface KindSpec {
  /** Sub-parent command name (`skill` | `agent` | `mcp`). */
  readonly name: "skill" | "agent" | "mcp";
  /** Description for the sub-parent command (shown under `catalog --help`). */
  readonly parentDesc: string;
  /** Argument placeholder for ident-taking actions (`<name>` or `<fqn>`). */
  readonly identPlaceholder: string;
  /** Help text for the ident argument. */
  readonly identDesc: string;
  /** Filename for the `--anchor` flag description; `undefined` ⇒ no anchor flag. */
  readonly anchorDoc?: string;
  /** Per-action descriptions; optional ones gate registration of that command. */
  readonly descriptions: {
    readonly list: string;
    readonly show: string;
    readonly install: string;
    readonly rm: string;
    readonly ackPrereqs?: string;
    readonly enable?: string;
    readonly disable?: string;
  };
  readonly impls: KindImpls;
}

/**
 * Read the install-source flag pair (`--url` / `--file`) from a
 * commander opts bag. Returns a spread-friendly fragment ({} when
 * neither is set) so the impl bag gets `url?` / `file?` cleanly.
 * Validation (exactly-one, smuggling guard) lives inside the impl
 * (`buildInstallOrigin`) so the rule is enforced uniformly across
 * all 5 install/resolve commands.
 */
function installSourceFlags(opts: Record<string, unknown>): { url?: string; file?: string } {
  return { ...optionalString(opts, "url"), ...optionalString(opts, "file") };
}

const KIND_SPECS: readonly KindSpec[] = [
  {
    name: "skill",
    parentDesc: "Skill operations",
    identPlaceholder: "<name>",
    identDesc: "Skill name (FQN)",
    anchorDoc: "SKILL.md",
    descriptions: {
      list: "List installed skills",
      show: "Show one skill's entry (or just the anchor with --anchor)",
      install: "Install a skill from a URL or absolute server path",
      rm: "Remove a skill",
      ackPrereqs: "Acknowledge a skill's prereqs (lifts the prereqs-ack block)",
    },
    impls: {
      list: (opts) => catalogSkillList(opts),
      resolve: (source, opts) => catalogSkillResolve({ ...opts, ...source }),
      show: (name, anchor, opts) => catalogSkillShow(name, { ...opts, anchor: anchor === true }),
      install: (source, opts) => catalogSkillInstall({ ...opts, ...source }),
      rm: (name, opts) => catalogSkillRm(name, opts),
      syncResolve: (name, opts) => catalogSkillSyncResolve(name, opts),
      sync: (name, planToken, opts) => catalogSkillSync(name, planToken, opts),
      ackPrereqs: (name, opts) => catalogSkillAckPrereqs(name, opts),
    },
  },
  {
    name: "agent",
    parentDesc: "Agent operations",
    identPlaceholder: "<name>",
    identDesc: "Agent name (FQN)",
    anchorDoc: "AGENTS.md",
    descriptions: {
      list: "List installed agents",
      show: "Show one agent's entry (or just the anchor with --anchor)",
      install: "Install an agent from a URL or absolute server path",
      rm: "Remove an agent",
      ackPrereqs: "Acknowledge an agent's prereqs (lifts the prereqs-ack block)",
      enable: "Re-enable a disabled agent",
      disable: "Disable an agent (new dispatches fail with EntryNotReadyError)",
    },
    impls: {
      list: (opts) => catalogAgentList(opts),
      resolve: (source, opts) => catalogAgentResolve({ ...opts, ...source }),
      show: (name, anchor, opts) => catalogAgentShow(name, { ...opts, anchor: anchor === true }),
      install: (source, opts) => catalogAgentInstall({ ...opts, ...source }),
      rm: (name, opts) => catalogAgentRm(name, opts),
      syncResolve: (name, opts) => catalogAgentSyncResolve(name, opts),
      sync: (name, planToken, opts) => catalogAgentSync(name, planToken, opts),
      ackPrereqs: (name, opts) => catalogAgentAckPrereqs(name, opts),
      enable: (name, opts) => catalogAgentEnable(name, opts),
      disable: (name, opts) => catalogAgentDisable(name, opts),
    },
  },
  {
    name: "mcp",
    parentDesc: "MCP operations",
    identPlaceholder: "<fqn>",
    identDesc: "MCP FQN (<namespace>/<short>)",
    descriptions: {
      list: "List installed MCPs",
      show: "Show one MCP's content",
      install:
        "Install an MCP from a URL or absolute server path (fqn is derived from the JSON's `_meta.name`)",
      rm: "Remove an MCP",
    },
    impls: {
      list: (opts) => catalogMcpList(opts),
      show: (fqn, _anchor, opts) => catalogMcpShow(fqn, opts),
      install: (source, opts) => catalogMcpInstall({ ...opts, ...source }),
      rm: (fqn, opts) => catalogMcpRm(fqn, opts),
      syncResolve: (fqn, opts) => catalogMcpSyncResolve(fqn, opts),
      sync: (fqn, planToken, opts) => catalogMcpSync(fqn, planToken, opts),
    },
  },
];

/**
 * Register `glyph catalog …` under the given top-level program.
 * Always registers `catalog overview` plus one sub-parent per
 * {@link KIND_SPECS} entry. Within each kind, commands are registered
 * in a fixed order matching the original flat wiring (Commander uses
 * registration order for `--help` output, so this is part of the
 * user-visible contract).
 */
export function registerCatalogCommands(program: Command, slot: Slot): void {
  const catalogCmd = program
    .command("catalog")
    .description("Catalog operations (workspace-scoped)");

  withWorkspaceFlags(catalogCmd.command("overview"))
    .description("Per-workspace catalog counts")
    .action(async (opts: Record<string, unknown>) => {
      slot.result = await catalogOverview(parseWorkspaceFlags(opts));
    });

  for (const spec of KIND_SPECS) {
    const sub = catalogCmd.command(spec.name).description(spec.parentDesc);

    withWorkspaceFlags(sub.command("list"))
      .description(spec.descriptions.list)
      .action(async (opts: Record<string, unknown>) => {
        slot.result = await spec.impls.list(parseWorkspaceFlags(opts));
      });

    if (spec.impls.resolve) {
      const resolve = spec.impls.resolve;
      withWorkspaceFlags(sub.command("resolve"))
        .description("Preview an install plan")
        .option("--url <value>", "Origin URL (e.g. https://github.com/owner/repo/tree/ref/path)")
        .option("--file <path>", "Absolute path on the glyph server's filesystem")
        .action(async (opts: Record<string, unknown>) => {
          slot.result = await resolve(installSourceFlags(opts), parseWorkspaceFlags(opts));
        });
    }

    {
      const showCmd = withWorkspaceFlags(sub.command("show"))
        .argument(spec.identPlaceholder, spec.identDesc)
        .description(spec.descriptions.show);
      if (spec.anchorDoc !== undefined) {
        showCmd.option(
          "--anchor",
          `Fetch only the ${spec.anchorDoc} anchor bytes via the dedicated endpoint`,
        );
      }
      const hasAnchor = spec.anchorDoc !== undefined;
      showCmd.action(async (ident: string, opts: Record<string, unknown>) => {
        const anchor = hasAnchor ? opts.anchor === true : undefined;
        slot.result = await spec.impls.show(ident, anchor, parseWorkspaceFlags(opts));
      });
    }

    withWorkspaceFlags(sub.command("install"))
      .description(spec.descriptions.install)
      .option("--url <value>", "Origin URL (e.g. https://github.com/owner/repo/tree/ref/path)")
      .option("--file <path>", "Absolute path on the glyph server's filesystem")
      .action(async (opts: Record<string, unknown>) => {
        slot.result = await spec.impls.install(installSourceFlags(opts), parseWorkspaceFlags(opts));
      });

    withWorkspaceFlags(sub.command("rm"))
      .argument(spec.identPlaceholder, spec.identDesc)
      .description(spec.descriptions.rm)
      .action(async (ident: string, opts: Record<string, unknown>) => {
        slot.result = await spec.impls.rm(ident, parseWorkspaceFlags(opts));
      });

    withWorkspaceFlags(sub.command("sync-resolve"))
      .argument(spec.identPlaceholder, spec.identDesc)
      .description("Preview a re-sync plan against the upstream origin")
      .action(async (ident: string, opts: Record<string, unknown>) => {
        slot.result = await spec.impls.syncResolve(ident, parseWorkspaceFlags(opts));
      });

    withWorkspaceFlags(sub.command("sync"))
      .argument(spec.identPlaceholder, spec.identDesc)
      .requiredOption("--plan-token <token>", `planToken from \`${spec.name} sync-resolve\``)
      .description("Apply a previewed sync plan")
      .action(async (ident: string, opts: Record<string, unknown>) => {
        slot.result = await spec.impls.sync(
          ident,
          pickString(opts, "planToken") ?? "",
          parseWorkspaceFlags(opts),
        );
      });

    if (spec.impls.ackPrereqs && spec.descriptions.ackPrereqs !== undefined) {
      const ackPrereqs = spec.impls.ackPrereqs;
      withWorkspaceFlags(sub.command("ack-prereqs"))
        .argument(spec.identPlaceholder, spec.identDesc)
        .description(spec.descriptions.ackPrereqs)
        .action(async (ident: string, opts: Record<string, unknown>) => {
          slot.result = await ackPrereqs(ident, parseWorkspaceFlags(opts));
        });
    }

    if (spec.impls.enable && spec.descriptions.enable !== undefined) {
      const enable = spec.impls.enable;
      withWorkspaceFlags(sub.command("enable"))
        .argument(spec.identPlaceholder, spec.identDesc)
        .description(spec.descriptions.enable)
        .action(async (ident: string, opts: Record<string, unknown>) => {
          slot.result = await enable(ident, parseWorkspaceFlags(opts));
        });
    }
    if (spec.impls.disable && spec.descriptions.disable !== undefined) {
      const disable = spec.impls.disable;
      withWorkspaceFlags(sub.command("disable"))
        .argument(spec.identPlaceholder, spec.identDesc)
        .description(spec.descriptions.disable)
        .action(async (ident: string, opts: Record<string, unknown>) => {
          slot.result = await disable(ident, parseWorkspaceFlags(opts));
        });
    }
  }
}
