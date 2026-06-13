import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setActiveWorkspace } from "../src/api";
import { PatchDialog } from "../src/pages/catalog/PatchDialog";

/**
 * PatchDialog round-trip lock-in for agent→agent edges.
 *
 * 1. GET /catalog/agents/:fqn returns an agent whose `dependencies.agents`
 *    has two entries.
 * 2. Dialog mounts in form mode, populates the Agent dependencies chip
 *    group with both entries.
 * 3. User clicks × on one chip, then Save.
 * 4. PATCH /catalog/agents/:fqn fires with `dependencies.agents`
 *    reduced to the kept entry (still wrapped in the `dependencies`
 *    object since other dep arrays are also populated).
 */

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

const AGENT_FQN = "official/engineer";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function emptyOk(): Response {
  return new Response(null, { status: 204 });
}

beforeEach(() => {
  setActiveWorkspace("ws-1");
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
    };
  }
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  setActiveWorkspace(null);
  vi.restoreAllMocks();
});

describe("PatchDialog — agent→agent deps round-trip", () => {
  it("posts the reduced agents list when an agent chip is removed", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.endsWith(`/catalog/agents/${encodeURIComponent(AGENT_FQN)}`)) {
        return jsonResponse({
          agent: {
            fqn: AGENT_FQN,
            origin: "file:/tmp/dev",
            description: "dev agent",
            version: "1.0.0",
            mutable: true,
            prereqsAck: true,
            disabledByUser: false,
            installedAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
            dependencies: {
              skills: [],
              mcps: [],
              agents: [{ fqn: "official/reviewer" }, { fqn: "acme/qa" }],
            },
          },
          status: "ready",
          content: "# dev agent",
        });
      }
      if (method === "PATCH") {
        return emptyOk();
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
    });
    const onSaved = vi.fn();
    render(
      <PatchDialog
        kind="agent"
        name={AGENT_FQN}
        availableSkills={[]}
        availableMcps={[]}
        availableAgents={[
          { fqn: "official/reviewer", origin: "file:/tmp/reviewer" },
          { fqn: "acme/qa", origin: "file:/tmp/qa" },
        ]}
        onClose={() => {}}
        onSaved={onSaved}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("official/reviewer")).toBeTruthy();
      expect(screen.getByText("acme/qa")).toBeTruthy();
    });

    // Remove the `acme/qa` chip via its × button (aria-label
    // matches the ChipsInput template literal).
    const removeQa = screen.getByLabelText("Remove acme/qa");
    fireEvent.click(removeQa);

    await waitFor(() => {
      expect(screen.queryByText("acme/qa")).toBeNull();
    });

    // Save → PATCH body.
    const saveBtn = screen.getByRole("button", { name: "Save" });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });

    // Find the PATCH call and parse its body.
    const patchCall = fetchMock.mock.calls.find(([, init]) => {
      const m = (init as RequestInit | undefined)?.method;
      return typeof m === "string" && m.toUpperCase() === "PATCH";
    });
    expect(patchCall).toBeTruthy();
    const body = JSON.parse(String((patchCall![1] as RequestInit).body));
    // Wire shape carries origin URI strings (NOT FQNs) — the form
    // resolves FQN → origin via the `availableAgents` map on load
    // and ships the resolved values through unchanged on save.
    expect(body.dependencies).toEqual({
      skills: [],
      mcps: [],
      agents: ["file:/tmp/reviewer"],
    });
  });

  it("does NOT forward an `agents` array when the kind is skill", async () => {
    const SKILL_FQN = "acme/some-skill";
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.endsWith(`/catalog/skills/${encodeURIComponent(SKILL_FQN)}`)) {
        return jsonResponse({
          skill: {
            fqn: SKILL_FQN,
            origin: "file:/tmp/skill",
            description: "skill",
            version: "1.0.0",
            mutable: true,
            prereqsAck: true,
            orphaned: false,
            installedAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
            dependencies: {
              skills: [{ fqn: "acme/dep-skill" }],
              mcps: [],
            },
          },
          status: "ready",
          content: "# skill",
        });
      }
      if (method === "PATCH") {
        return emptyOk();
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
    });

    const onSaved = vi.fn();
    render(
      <PatchDialog
        kind="skill"
        name={SKILL_FQN}
        availableSkills={[{ fqn: "acme/dep-skill", origin: "file:/tmp/dep-skill" }]}
        availableMcps={[]}
        availableAgents={[]}
        onClose={() => {}}
        onSaved={onSaved}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("acme/dep-skill")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });

    const patchCall = fetchMock.mock.calls.find(([, init]) => {
      const m = (init as RequestInit | undefined)?.method;
      return typeof m === "string" && m.toUpperCase() === "PATCH";
    });
    expect(patchCall).toBeTruthy();
    const body = JSON.parse(String((patchCall![1] as RequestInit).body));
    expect(body.dependencies).toEqual({
      skills: ["file:/tmp/dep-skill"],
      mcps: [],
    });
    // Critical: the skill adapter must NOT forward an `agents` array.
    expect("agents" in body.dependencies).toBe(false);
  });

  it("offers installed agents in the dropdown on focus (excluding already-selected)", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith(`/catalog/agents/${encodeURIComponent(AGENT_FQN)}`)) {
        return jsonResponse({
          agent: {
            fqn: AGENT_FQN,
            origin: "file:/tmp/dev",
            description: "dev agent",
            version: "1.0.0",
            mutable: true,
            prereqsAck: true,
            disabledByUser: false,
            installedAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
            dependencies: {
              skills: [],
              mcps: [],
              agents: [{ fqn: "official/reviewer" }],
            },
          },
          status: "ready",
          content: "# dev agent",
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(
      <PatchDialog
        kind="agent"
        name={AGENT_FQN}
        availableSkills={[]}
        availableMcps={[]}
        availableAgents={[
          { fqn: "official/reviewer", origin: "file:/tmp/reviewer" },
          { fqn: "acme/qa", origin: "file:/tmp/qa" },
          { fqn: "acme/designer", origin: "file:/tmp/designer" },
        ]}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("official/reviewer")).toBeTruthy();
    });

    // Focus the agents input to open the suggestion dropdown.
    const agentInput = document.getElementById("md-agents") as HTMLInputElement | null;
    expect(agentInput).toBeTruthy();
    fireEvent.focus(agentInput!);

    await waitFor(() => {
      // Dropdown rows render `<PlusIcon /> <span>{label}</span>` inside a button.
      const items = document.querySelectorAll(".chips__suggest-item span");
      const labels = Array.from(items).map((s) => s.textContent);
      // The already-selected `official/reviewer` must NOT appear.
      expect(labels).toContain("acme/qa");
      expect(labels).toContain("acme/designer");
      expect(labels).not.toContain("official/reviewer");
    });
  });

  it("stores the picked entry's origin URI (not its FQN) when added via dropdown", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.endsWith(`/catalog/agents/${encodeURIComponent(AGENT_FQN)}`)) {
        return jsonResponse({
          agent: {
            fqn: AGENT_FQN,
            origin: "file:/tmp/dev",
            description: "dev agent",
            version: "1.0.0",
            mutable: true,
            prereqsAck: true,
            disabledByUser: false,
            installedAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
          status: "ready",
          content: "# dev agent",
        });
      }
      if (method === "PATCH") return emptyOk();
      throw new Error(`unexpected fetch: ${method} ${url}`);
    });

    const onSaved = vi.fn();
    render(
      <PatchDialog
        kind="agent"
        name={AGENT_FQN}
        availableSkills={[]}
        availableMcps={[]}
        availableAgents={[{ fqn: "official/reviewer", origin: "file:/tmp/reviewer" }]}
        onClose={() => {}}
        onSaved={onSaved}
      />,
    );

    // Wait for the form to mount with an empty agent-deps chip group.
    const agentInput = await waitFor(() => {
      const el = document.getElementById("md-agents") as HTMLInputElement | null;
      expect(el).toBeTruthy();
      return el!;
    });

    // Open dropdown and click the only installed agent option.
    fireEvent.focus(agentInput);
    const option = await waitFor(() => {
      const items = Array.from(
        document.querySelectorAll<HTMLButtonElement>(".chips__suggest-item"),
      );
      const hit = items.find((b) => b.textContent?.includes("official/reviewer"));
      expect(hit).toBeTruthy();
      return hit!;
    });
    // The dropdown commits its selection on `mousedown` (so the input
    // blur doesn't fire first); fire that event explicitly.
    fireEvent.mouseDown(option);

    // Chip now visible with the FQN label.
    await waitFor(() => {
      expect(screen.getByText("official/reviewer")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });

    const patchCall = fetchMock.mock.calls.find(([, init]) => {
      const m = (init as RequestInit | undefined)?.method;
      return typeof m === "string" && m.toUpperCase() === "PATCH";
    });
    expect(patchCall).toBeTruthy();
    const body = JSON.parse(String((patchCall![1] as RequestInit).body));
    // The dropdown stored the ORIGIN URI in form state; the patch
    // body forwards it verbatim. If the form had stored the FQN we'd
    // see "official/reviewer" here instead — the latent-bug regression
    // this PR fixes as a side-effect.
    expect(body.dependencies).toEqual({
      skills: [],
      mcps: [],
      agents: ["file:/tmp/reviewer"],
    });
  });

  it("commits the highlighted dropdown row's origin URI on ArrowDown then Enter", async () => {
    // Designer F1 regression: keyboard users must be able to add an
    // installed entry without touching the mouse. ArrowDown moves the
    // active suggestion; Enter commits it via origin URI (not FQN).
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.endsWith(`/catalog/agents/${encodeURIComponent(AGENT_FQN)}`)) {
        return jsonResponse({
          agent: {
            fqn: AGENT_FQN,
            origin: "file:/tmp/dev",
            description: "dev agent",
            version: "1.0.0",
            mutable: true,
            prereqsAck: true,
            disabledByUser: false,
            installedAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
          status: "ready",
          content: "# dev agent",
        });
      }
      if (method === "PATCH") return emptyOk();
      throw new Error(`unexpected fetch: ${method} ${url}`);
    });

    const onSaved = vi.fn();
    render(
      <PatchDialog
        kind="agent"
        name={AGENT_FQN}
        availableSkills={[]}
        availableMcps={[]}
        availableAgents={[{ fqn: "official/reviewer", origin: "file:/tmp/reviewer" }]}
        onClose={() => {}}
        onSaved={onSaved}
      />,
    );

    const agentInput = await waitFor(() => {
      const el = document.getElementById("md-agents") as HTMLInputElement | null;
      expect(el).toBeTruthy();
      return el!;
    });

    // Open dropdown, then walk down with the keyboard.
    fireEvent.focus(agentInput);
    fireEvent.keyDown(agentInput, { key: "ArrowDown" });
    // The active row is the only suggestion; aria-activedescendant
    // points at it and aria-selected=true is set on the row.
    await waitFor(() => {
      const active = document.querySelector('[role="option"][aria-selected="true"]');
      expect(active?.textContent).toContain("official/reviewer");
    });
    // Commit with Enter.
    fireEvent.keyDown(agentInput, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("official/reviewer")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });

    const patchCall = fetchMock.mock.calls.find(([, init]) => {
      const m = (init as RequestInit | undefined)?.method;
      return typeof m === "string" && m.toUpperCase() === "PATCH";
    });
    expect(patchCall).toBeTruthy();
    const body = JSON.parse(String((patchCall![1] as RequestInit).body));
    expect(body.dependencies).toEqual({
      skills: [],
      mcps: [],
      agents: ["file:/tmp/reviewer"],
    });
  });

  it("commits the matching option's origin URI when the user types an FQN and presses Enter", async () => {
    // Designer F2 regression: typing an FQN exactly matching a
    // dropdown row and pressing Enter must commit the option's
    // origin URI — NOT the raw FQN. Otherwise the wire-shape bug the
    // PR is supposed to fix re-surfaces via the only keyboard add
    // path and the chip renders red ("missing").
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.endsWith(`/catalog/agents/${encodeURIComponent(AGENT_FQN)}`)) {
        return jsonResponse({
          agent: {
            fqn: AGENT_FQN,
            origin: "file:/tmp/dev",
            description: "dev agent",
            version: "1.0.0",
            mutable: true,
            prereqsAck: true,
            disabledByUser: false,
            installedAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
          status: "ready",
          content: "# dev agent",
        });
      }
      if (method === "PATCH") return emptyOk();
      throw new Error(`unexpected fetch: ${method} ${url}`);
    });

    const onSaved = vi.fn();
    render(
      <PatchDialog
        kind="agent"
        name={AGENT_FQN}
        availableSkills={[]}
        availableMcps={[]}
        availableAgents={[{ fqn: "official/reviewer", origin: "file:/tmp/reviewer" }]}
        onClose={() => {}}
        onSaved={onSaved}
      />,
    );

    const agentInput = await waitFor(() => {
      const el = document.getElementById("md-agents") as HTMLInputElement | null;
      expect(el).toBeTruthy();
      return el!;
    });

    // Focus, type the full FQN, then press Enter without ever using
    // ArrowDown (the activeIndex stays at -1; the label-match branch
    // must rescue the wire-shape).
    fireEvent.focus(agentInput);
    fireEvent.change(agentInput, { target: { value: "official/reviewer" } });
    fireEvent.keyDown(agentInput, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("official/reviewer")).toBeTruthy();
    });
    // No red "missing" chip — the form considered the typed value a
    // catalog hit and stored the origin URI.
    expect(document.querySelector(".chips__chip--invalid")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });

    const patchCall = fetchMock.mock.calls.find(([, init]) => {
      const m = (init as RequestInit | undefined)?.method;
      return typeof m === "string" && m.toUpperCase() === "PATCH";
    });
    expect(patchCall).toBeTruthy();
    const body = JSON.parse(String((patchCall![1] as RequestInit).body));
    expect(body.dependencies.agents).toEqual(["file:/tmp/reviewer"]);
  });

  it("closes the suggestion dropdown when focus leaves the input via Tab", async () => {
    // Designer F4 regression: a true Tab-out blur must hide the
    // dropdown so suggestions don't visually persist over content
    // that no longer has focus.
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith(`/catalog/agents/${encodeURIComponent(AGENT_FQN)}`)) {
        return jsonResponse({
          agent: {
            fqn: AGENT_FQN,
            origin: "file:/tmp/dev",
            description: "dev agent",
            version: "1.0.0",
            mutable: true,
            prereqsAck: true,
            disabledByUser: false,
            installedAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
          status: "ready",
          content: "# dev agent",
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(
      <PatchDialog
        kind="agent"
        name={AGENT_FQN}
        availableSkills={[]}
        availableMcps={[]}
        availableAgents={[{ fqn: "official/reviewer", origin: "file:/tmp/reviewer" }]}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );

    const agentInput = await waitFor(() => {
      const el = document.getElementById("md-agents") as HTMLInputElement | null;
      expect(el).toBeTruthy();
      return el!;
    });

    fireEvent.focus(agentInput);
    await waitFor(() => {
      expect(document.querySelector('[role="listbox"]')).toBeTruthy();
    });

    // Blur with a relatedTarget outside the chips container (the Save
    // button — wherever the user would Tab to next).
    const saveBtn = screen.getByRole("button", { name: "Save" });
    fireEvent.blur(agentInput, { relatedTarget: saveBtn });

    await waitFor(() => {
      expect(document.querySelector('[role="listbox"]')).toBeNull();
    });
  });
});
