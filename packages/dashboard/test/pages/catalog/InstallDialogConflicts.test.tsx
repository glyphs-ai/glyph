import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { InstallConflict } from "../../../src/api/catalog";
import { InstallDialog } from "../../../src/pages/catalog/InstallDialog";

/**
 * InstallDialog warning-row lock-in. When `conflicts` is non-empty the
 * dialog must render a `role=status` warning block above the error row
 * naming the dropped dep's kind, origin, and a fix hint. When the
 * array is empty the block is suppressed entirely so a clean install
 * doesn't leak a phantom warning frame.
 *
 * The component is rendered in isolation (no MemoryRouter / page
 * harness) because the warning-row contract is purely a function of
 * props — coupling to `CatalogPage` would obscure the boundary.
 */

afterEach(() => {
  cleanup();
});

function fetchFailedConflict(origin: string): InstallConflict {
  return {
    kind: "agent",
    origin,
    fqn: null,
    reason: { kind: "fetch-failed", cause: { message: "ENOENT: no such file" } },
  };
}

function renderDialog(conflicts: readonly InstallConflict[]) {
  return render(
    <InstallDialog
      kind="agent"
      open={true}
      busy={false}
      error={null}
      conflicts={conflicts}
      onClose={() => {}}
      onSubmit={() => {}}
    />,
  );
}

describe("InstallDialog conflict warning row", () => {
  it("renders the warning block when conflicts is non-empty", () => {
    renderDialog([fetchFailedConflict("file:/missing/engineer/AGENTS.md")]);
    expect(screen.getByText("1 dependency was not installed:")).toBeTruthy();
    expect(screen.getByText(/agent file:\/missing\/engineer\/AGENTS\.md/)).toBeTruthy();
    expect(screen.getByText(/failed to fetch from upstream/)).toBeTruthy();
    expect(screen.getByText(/ENOENT: no such file/)).toBeTruthy();
  });

  it("pluralises the header when multiple conflicts are present", () => {
    renderDialog([
      fetchFailedConflict("file:/a/AGENTS.md"),
      fetchFailedConflict("file:/b/AGENTS.md"),
    ]);
    expect(screen.getByText("2 dependencies were not installed:")).toBeTruthy();
  });

  it("suppresses the warning block entirely when conflicts is empty", () => {
    renderDialog([]);
    expect(screen.queryByText(/dependency was not installed/)).toBeNull();
    expect(screen.queryByText(/dependencies were not installed/)).toBeNull();
  });

  it("uses role=status so the warning is announced without stealing focus", () => {
    renderDialog([fetchFailedConflict("file:/x/AGENTS.md")]);
    const statusRegions = screen.getAllByRole("status");
    expect(statusRegions.length).toBeGreaterThan(0);
    expect(statusRegions.some((el) => el.textContent?.includes("file:/x/AGENTS.md"))).toBe(true);
  });
});
