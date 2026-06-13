import type { AgentEntry, SkillEntry } from "@glyphs-ai/contracts";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setActiveWorkspace } from "../../src/api";
import type { McpItem } from "../../src/api/catalog";
import { CatalogPage } from "../../src/pages/Catalog";

/**
 * Catalog page `?entry=<fqn>` deep-link contract:
 *
 *  - present + entry installed → the entry's dialog mounts on first
 *    render (the same dialog you'd get by clicking the card's Configure).
 *  - present + entry not in the list (stale link / uninstalled) →
 *    silent no-op; the Catalog page renders normally, no dialog, no error.
 *  - dialog close (× or backdrop) → the `?entry=` URL param is stripped
 *    so a refresh doesn't re-open the dialog and the URL stays canonical.
 */

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function makeAgent(fqn: string, mutable: boolean): AgentEntry {
  const [scope, short] = fqn.split("/");
  return {
    agent: {
      fqn,
      scope,
      short,
      origin: mutable ? `file:/tmp/${short}` : `https://example.com/${fqn}`,
      description: `${fqn} description`,
      version: "1.0.0",
      mutable,
    },
    status: "ready",
    missingDeps: [],
  } as unknown as AgentEntry;
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

/**
 * Probe component that surfaces `location.search` to the test so we
 * can assert URL state changes (the page itself only writes through
 * `useUrlSearchValue`).
 */
function SearchProbe() {
  const loc = useLocation();
  return <div data-testid="probe-search">{loc.search}</div>;
}

function renderCatalogAt(initialPath: string, agents: AgentEntry[]) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="/workspaces/:workspaceId/catalog/agents"
          element={
            <>
              <CatalogPage
                tab="agents"
                onTabChange={() => {}}
                skills={[] as SkillEntry[]}
                agents={agents}
                mcps={[] as McpItem[]}
                currentWorkspaceId="ws-1"
                onChanged={() => {}}
              />
              <SearchProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Catalog ?entry=<fqn> deep-link", () => {
  it("auto-opens the matching agent's dialog on mount (immutable → DetailDialog)", async () => {
    // Immutable agent → DetailDialog → GET /catalog/agents/:fqn fires
    // as soon as the dialog mounts.
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/catalog/agents/official%2Fcoordinator")) {
        return jsonResponse({
          agent: {
            fqn: "official/coordinator",
            origin: "https://example.com/official/coordinator",
            description: "coordinator agent",
            version: "1.0.0",
            mutable: false,
            prereqsAck: true,
            disabledByUser: false,
            installedAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
          status: "ready",
          content: "# coordinator",
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    renderCatalogAt("/workspaces/ws-1/catalog/agents?entry=official%2Fcoordinator", [
      makeAgent("official/coordinator", false),
      makeAgent("acme/qa", false),
    ]);

    // The dialog appears: DetailDialog's hero renders "AGENT" + the FQN.
    await waitFor(() => {
      expect(screen.getByText("coordinator agent")).toBeTruthy();
    });
  });

  it("is a silent no-op when ?entry= points at a stale / uninstalled FQN", async () => {
    renderCatalogAt("/workspaces/ws-1/catalog/agents?entry=ghost%2Fmissing", [
      makeAgent("official/coordinator", false),
    ]);

    // The catalog still renders cards.
    await waitFor(() => {
      expect(
        document.querySelector('.card-grid__item[data-entry-name="official/coordinator"]'),
      ).toBeTruthy();
    });

    // No fetch fired (DetailDialog never mounted) and no dialog opened.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector("dialog[open]")).toBeNull();
  });

  it("strips ?entry= from the URL when the dialog is closed", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/catalog/agents/official%2Fcoordinator")) {
        return jsonResponse({
          agent: {
            fqn: "official/coordinator",
            origin: "https://example.com/official/coordinator",
            description: "coordinator agent",
            version: "1.0.0",
            mutable: false,
            prereqsAck: true,
            disabledByUser: false,
            installedAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
          status: "ready",
          content: "# coordinator",
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    renderCatalogAt("/workspaces/ws-1/catalog/agents?entry=official%2Fcoordinator", [
      makeAgent("official/coordinator", false),
    ]);

    await waitFor(() => {
      expect(screen.getByText("coordinator agent")).toBeTruthy();
    });
    // Sanity: the probe reports the original URL state.
    expect(screen.getByTestId("probe-search").textContent).toContain(
      "entry=official%2Fcoordinator",
    );

    // Modal × button has aria-label "Close". Scope by the actually-open
    // <dialog>; the page also renders InstallDialog/RmDialog which have
    // their own close buttons in the DOM even when closed.
    const openDialog = document.querySelector("dialog[open]") as HTMLElement | null;
    expect(openDialog).toBeTruthy();
    const closeBtn = within(openDialog!).getByLabelText("Close");
    fireEvent.click(closeBtn);

    await waitFor(() => {
      // The URL key was removed entirely (useUrlSearchValue's
      // default-sentinel "" deletes the param), so the probe reads
      // an empty search.
      expect(screen.getByTestId("probe-search").textContent).toBe("");
    });
  });
});
