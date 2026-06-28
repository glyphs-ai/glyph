import { McpNotFoundError, McpOriginConflictError } from "../contract/mcp.errors.js";
import { McpEntity } from "../domain/mcp.entity.js";
import { Origin } from "../domain/origin.js";
import { safeNormalize, sameOrigin } from "../fetcher/origin.js";
import type { McpRepository } from "../persistence/mcp.repository.js";

export type McpFetcher = (origin: string) => Promise<string>;

export interface McpServiceOpts {
  readonly repo: McpRepository;
  readonly fetcher: McpFetcher;
}

/**
 * Application-layer service for MCP operations. Uses `fqn` everywhere
 * internally (matches the FK columns in the catalog DB). The single
 * exception is `install(name, ...)` where `name` is the wire-side
 * input that an external caller provides; downstream the value is
 * treated as the fqn and validated as such.
 */
export class McpService {
  private readonly repo: McpRepository;
  private readonly fetcher: McpFetcher;

  constructor(opts: McpServiceOpts) {
    this.repo = opts.repo;
    this.fetcher = opts.fetcher;
  }

  async install(name: string, origin: string, rawContent: string): Promise<McpEntity> {
    const entity = McpEntity.create(name, Origin.parse(safeNormalize(origin)), rawContent);
    const existing = await this.repo.findById(entity.fqn);
    if (existing && !sameOrigin(existing.origin, entity.origin)) {
      throw new McpOriginConflictError(entity.fqn, existing.origin, entity.origin);
    }
    await this.repo.insert(entity);
    return (await this.repo.findById(entity.fqn)) ?? entity;
  }

  async installFromOrigin(name: string, origin: string): Promise<McpEntity> {
    const content = await this.fetcher(origin);
    return this.install(name, origin, content);
  }

  async getContent(fqn: string): Promise<string> {
    const entity = await this.repo.findById(fqn);
    if (!entity) throw new McpNotFoundError(fqn);
    return entity.spec;
  }

  async delete(fqn: string): Promise<void> {
    const existing = await this.repo.findById(fqn);
    if (!existing) throw new McpNotFoundError(fqn);
    await this.repo.delete(fqn);
  }

  async get(fqn: string): Promise<McpEntity | null> {
    return (await this.repo.findById(fqn)) ?? null;
  }

  async getByOrigin(origin: string): Promise<McpEntity | null> {
    return (await this.repo.findByOrigin(safeNormalize(origin))) ?? null;
  }

  async list(): Promise<McpEntity[]> {
    return this.repo.findAll();
  }

  async has(fqn: string): Promise<boolean> {
    return (await this.repo.findById(fqn)) !== undefined;
  }

  close(): void {
    this.repo.close?.();
  }
}
