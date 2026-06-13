import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setActiveWorkspace } from "../src/api";
import { DetailDialog } from "../src/components/DetailDialog";

/**
 * DetailDialog Overview tab — Agents row lock-in.
 *
 * When the target is an agent whose `dependencies.agents` is populated,
 * the dialog must render an `<dt>Agents</dt>` row listing each agent
 * FQN. When the agent has no agent deps, the row still renders with a
 * "None" placeholder. The row must NOT appear for skill or mcp details
 * (skills cannot declare agent deps; mcps have no deps at all).
 */

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setActiveWorkspace("ws-1");
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  // happy-dom implements <dialog> but `showModal` throws if the dialog
  // isn't connected to the document via the modal queue. Stub both so
  // the dialog opens reliably in jsdom + happy-dom.
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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("DetailDialog — agent→agent deps row", () => {
  it("renders an Agents row populated from dependencies.agents for agent details", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        agent: {
          fqn: "official/engineer",
          origin: "file:/tmp/dev",
          description: "self-dev agent",
          version: "1.0.0",
          mutable: false,
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
      }),
    );

    render(
      <MemoryRouter>
        <DetailDialog
          target={{ kind: "agent", name: "official/engineer" }}
          workspaceId="ws-1"
          onClose={() => {}}
          onSynced={() => {}}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Agents")).toBeTruthy();
    });
    expect(screen.getByText("official/reviewer")).toBeTruthy();
    expect(screen.getByText("acme/qa")).toBeTruthy();
  });

  it("renders dep chips as Catalog deep-link <a href> elements (no target=_blank)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        agent: {
          fqn: "official/engineer",
          origin: "file:/tmp/dev",
          description: "self-dev agent",
          version: "1.0.0",
          mutable: false,
          prereqsAck: true,
          disabledByUser: false,
          installedAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          dependencies: {
            skills: [{ fqn: "official/git-pr" }],
            mcps: [{ fqn: "github/mcp" }],
            agents: [{ fqn: "official/coordinator" }],
          },
        },
        status: "ready",
        content: "# dev agent",
      }),
    );

    render(
      <MemoryRouter>
        <DetailDialog
          target={{ kind: "agent", name: "official/engineer" }}
          workspaceId="ws-1"
          onClose={() => {}}
          onSynced={() => {}}
        />
      </MemoryRouter>,
    );

    // Each dep chip should be an <a> with a Catalog-page deep-link
    // pointing at the dep's own dialog. Slashes inside the FQN are
    // %-encoded so URLSearchParams round-trips them cleanly. No
    // target="_blank" — same-tab navigation is the contract; cmd-click
    // opens a new tab via browser default.
    const skillLink = (await waitFor(() => {
      const a = document.querySelector(
        'a.detail-dialog__dep[href$="entry=official%2Fgit-pr"]',
      ) as HTMLAnchorElement | null;
      expect(a).toBeTruthy();
      return a!;
    })) as HTMLAnchorElement;
    expect(skillLink.getAttribute("href")).toBe(
      "/workspaces/ws-1/catalog/skills?entry=official%2Fgit-pr",
    );
    expect(skillLink.getAttribute("target")).toBeNull();

    const mcpLink = document.querySelector(
      'a.detail-dialog__dep[href$="entry=github%2Fmcp"]',
    ) as HTMLAnchorElement | null;
    expect(mcpLink?.getAttribute("href")).toBe("/workspaces/ws-1/catalog/mcps?entry=github%2Fmcp");

    const agentLink = document.querySelector(
      'a.detail-dialog__dep[href$="entry=official%2Fcoordinator"]',
    ) as HTMLAnchorElement | null;
    expect(agentLink?.getAttribute("href")).toBe(
      "/workspaces/ws-1/catalog/agents?entry=official%2Fcoordinator",
    );
  });

  it("renders the Agents row with `None` when the agent has no agent deps", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        agent: {
          fqn: "acme/lonely",
          origin: "file:/tmp/lonely",
          description: "no deps",
          version: "1.0.0",
          mutable: false,
          prereqsAck: true,
          disabledByUser: false,
          installedAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
        status: "ready",
        content: "# lonely",
      }),
    );

    render(
      <MemoryRouter>
        <DetailDialog
          target={{ kind: "agent", name: "acme/lonely" }}
          workspaceId="ws-1"
          onClose={() => {}}
          onSynced={() => {}}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Agents")).toBeTruthy();
    });
    // The "None" placeholder is shared with Skills + MCPs rows; assert
    // there are at least three of them (one per dep block).
    const nones = screen.getAllByText("None");
    expect(nones.length).toBeGreaterThanOrEqual(3);
  });

  it("does NOT render the Agents row for skill details (skills cannot declare agent deps)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        skill: {
          fqn: "acme/some-skill",
          origin: "file:/tmp/skill",
          description: "skill desc",
          version: "1.0.0",
          mutable: false,
          prereqsAck: true,
          orphaned: false,
          installedAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
        status: "ready",
        content: "# skill",
      }),
    );

    render(
      <MemoryRouter>
        <DetailDialog
          target={{ kind: "skill", name: "acme/some-skill" }}
          workspaceId="ws-1"
          onClose={() => {}}
          onSynced={() => {}}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Skills")).toBeTruthy();
    });
    // Skill detail keeps the Skills + MCPs rows but omits Agents.
    expect(screen.queryByText("Agents")).toBeNull();
  });
});
