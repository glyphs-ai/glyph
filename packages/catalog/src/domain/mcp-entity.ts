/**
 * Domain entity for an installed MCP.
 *
 * Identity is `fqn` (the MCP-spec name `<namespace>/<short>`, e.g.
 * `azure/mcp`); `id` and `fqn` are the same value. `origin` is provenance,
 * and `spec` carries the raw JSON client-config bytes.
 *
 * `new McpEntity({...})` rehydrates trusted inputs. `McpEntity.create`
 * mints an aggregate with timestamps seeded from `now`.
 */

import type { McpFqn } from "./mcp-fqn.js";

export interface McpEntityArgs {
  readonly fqn: McpFqn;
  readonly origin: string;
  readonly spec: string;
  readonly installedAt: string;
  readonly updatedAt: string;
}

export interface CreateMcpArgs {
  readonly fqn: McpFqn;
  readonly origin: string;
  readonly spec: string;
  /** ISO-8601 timestamp; seeds both `installedAt` and `updatedAt`. */
  readonly now: string;
}

export class McpEntity {
  public readonly fqn: McpFqn;
  public readonly origin: string;
  public readonly spec: string;
  public readonly installedAt: string;
  public readonly updatedAt: string;

  constructor(args: McpEntityArgs) {
    this.fqn = args.fqn;
    this.origin = args.origin;
    this.spec = args.spec;
    this.installedAt = args.installedAt;
    this.updatedAt = args.updatedAt;
  }

  static create(args: CreateMcpArgs): McpEntity {
    return new McpEntity({
      fqn: args.fqn,
      origin: args.origin,
      spec: args.spec,
      installedAt: args.now,
      updatedAt: args.now,
    });
  }

  /** Identity alias — the fqn IS the id. */
  get id(): McpFqn {
    return this.fqn;
  }
}
