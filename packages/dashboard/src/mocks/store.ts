/**
 * Mutable in-memory store for the dashboard's MSW mock layer.
 *
 * Seeded from fixtures at module-load time; subsequent GET handlers read
 * from the store so mutations (POST/DELETE) are reflected in list views.
 * State resets on browser refresh (module re-import) — designer mode is
 * intentionally non-persistent.
 */

import type { AgentEntry, Mcp, SkillEntry } from "../api/catalog.js";
import type { SessionView, TaskRecord } from "../api/index.js";
import { cloneDeep } from "./clone.js";
import { fixtureAgents } from "./fixtures/agents.js";
import { fixtureSessions } from "./fixtures/sessions.js";
import { fixtureTasks } from "./fixtures/tasks.js";

export interface Store {
  tasks: TaskRecord[];
  sessions: SessionView[];
  agents: AgentEntry[];
  skills: SkillEntry[];
  mcps: Mcp[];
}

function seedStore(): Store {
  return {
    tasks: fixtureTasks.map((t) => cloneDeep(t)),
    sessions: fixtureSessions.map((s) => cloneDeep(s)),
    agents: fixtureAgents.map((a) => cloneDeep(a)) as AgentEntry[],
    skills: [],
    mcps: [],
  };
}

export const store: Store = seedStore();

/** Re-seed the store from fixtures. Useful for tests. */
export function resetStore(): void {
  const fresh = seedStore();
  store.tasks = fresh.tasks;
  store.sessions = fresh.sessions;
  store.agents = fresh.agents;
  store.skills = fresh.skills;
  store.mcps = fresh.mcps;
}
