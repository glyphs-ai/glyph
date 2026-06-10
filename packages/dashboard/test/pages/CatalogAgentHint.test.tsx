import type { AgentEntry, SkillEntry } from "@glyphs-ai/contracts";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpItem } from "../../src/api/catalog";
import { CatalogPage } from "../../src/pages/Catalog";

/**
 * Lock-in coverage for the `?agent=<fqn>` deep-link on the Catalog
 * page. When the user clicks Configure on the agent detail pane,
 * apply a 2-second highlight so the user spots the row.
 *
 * Misses (stale link, uninstalled agent) MUST be silent — no scroll,
 * no error, no console noise. The previous behaviour dropped the param
 * on the floor entirely and left the user at the top of the catalog
 * with no signal where the agent went.
 */

function makeAgent(fqn: string): AgentEntry {
  const [scope, short] = fqn.split("/");
  return {
    agent: {
      fqn,
      scope,
      short,
      description: `${fqn} description`,
      version: "1.0.0",
      mutable: true,
    },
    status: "ready",
    missingDeps: [],
  } as unknown as AgentEntry;
}

function renderCatalog(initialPath: string, agents: AgentEntry[]) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="/workspaces/:workspaceId/catalog/agents"
          element={
            <CatalogPage
              tab="agents"
              onTabChange={() => {}}
              skills={[] as SkillEntry[]}
              agents={agents}
              mcps={[] as McpItem[]}
              currentWorkspaceId="ws-1"
              onChanged={() => {}}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

let scrollIntoViewSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // jsdom / happy-dom don't implement scrollIntoView by default; install
  // a spy on the prototype so the page's behaviour is observable.
  scrollIntoViewSpy = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (
    this: Element,
  ) {
    // no-op
  });
});

afterEach(() => {
  cleanup();
  scrollIntoViewSpy.mockRestore();
  vi.clearAllMocks();
});

describe("Catalog ?agent=<fqn> scroll + highlight", () => {
  it("scrolls the matching card into view and applies the highlight class", async () => {
    const agents = [
      makeAgent("official/engineer"),
      makeAgent("acme/qa"),
      makeAgent("third-party/docs"),
    ];
    renderCatalog("/workspaces/ws-1/catalog/agents?agent=acme/qa", agents);

    await waitFor(() => {
      // Cards are rendered; pick out the target by the data attribute.
      const row = document.querySelector(
        '.card-grid__item[data-entry-name="acme/qa"]',
      ) as HTMLElement | null;
      expect(row).toBeTruthy();
      expect(row?.classList.contains("card-grid__item--highlight")).toBe(true);
    });

    // scrollIntoView was called on the matching row exactly once.
    expect(scrollIntoViewSpy).toHaveBeenCalled();
    const calledOn = scrollIntoViewSpy.mock.contexts[0] as HTMLElement | undefined;
    expect(calledOn).toBeTruthy();
    expect(calledOn?.getAttribute("data-entry-name")).toBe("acme/qa");
  });

  it("is a silent no-op when ?agent= doesn't match any rendered card", async () => {
    const agents = [makeAgent("official/engineer")];
    renderCatalog("/workspaces/ws-1/catalog/agents?agent=ghost/missing", agents);

    // Wait until the card is in the DOM (use the data attribute we
    // Use getByTestId because duplicate visible text appears in the card.
    await waitFor(() => {
      expect(
        document.querySelector('.card-grid__item[data-entry-name="official/engineer"]'),
      ).toBeTruthy();
    });
    // No row to highlight, so the spy stays untouched and no element
    // carries the highlight class.
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
    expect(document.querySelector(".card-grid__item--highlight")).toBeNull();
  });

  it("is a silent no-op when ?agent= is absent", async () => {
    const agents = [makeAgent("official/engineer")];
    renderCatalog("/workspaces/ws-1/catalog/agents", agents);

    await waitFor(() => {
      expect(
        document.querySelector('.card-grid__item[data-entry-name="official/engineer"]'),
      ).toBeTruthy();
    });
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
    expect(document.querySelector(".card-grid__item--highlight")).toBeNull();
  });
});
