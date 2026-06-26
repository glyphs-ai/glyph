import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmptyState } from "../../../src/components/common/EmptyState";

afterEach(cleanup);

describe("EmptyState", () => {
  it("renders icon, title, and hint", () => {
    render(<EmptyState icon="📝" title="No tasks yet" hint="Dispatch one." testId="es" />);
    const card = screen.getByTestId("es");
    expect(card.classList.contains("empty")).toBe(true);
    expect(card.querySelector(".empty__icon")?.textContent).toBe("📝");
    expect(screen.getByText("No tasks yet")).toBeTruthy();
    expect(screen.getByText("Dispatch one.")).toBeTruthy();
  });

  it("omits the hint paragraph when no hint is given", () => {
    render(<EmptyState icon="📝" title="No tasks yet" testId="es" />);
    expect(screen.getByTestId("es").querySelector(".empty__hint")).toBeNull();
  });

  it("renders a primary CTA by default and wires onClick", () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        icon="📝"
        title="No tasks yet"
        cta={{ label: "Dispatch task", onClick, testId: "es-cta" }}
      />,
    );
    const cta = screen.getByTestId("es-cta");
    expect(cta.classList.contains("btn--primary")).toBe(true);
    expect(cta.classList.contains("empty__cta")).toBe(true);
    expect(cta.textContent).toContain("Dispatch task");
    fireEvent.click(cta);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders a secondary CTA without the primary modifier", () => {
    render(
      <EmptyState
        icon="🔍"
        title="No matches"
        cta={{ label: "Clear filters", onClick: () => {}, variant: "secondary", testId: "es-cta" }}
      />,
    );
    const cta = screen.getByTestId("es-cta");
    expect(cta.classList.contains("btn")).toBe(true);
    expect(cta.classList.contains("btn--primary")).toBe(false);
    expect(cta.classList.contains("empty__cta")).toBe(true);
  });

  it("renders no button when no cta is provided", () => {
    render(<EmptyState icon="📝" title="No tasks yet" testId="es" />);
    expect(screen.getByTestId("es").querySelector("button")).toBeNull();
  });

  it("disables the CTA and surfaces the disabled title", () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        icon="📝"
        title="No tasks yet"
        cta={{
          label: "Dispatch task",
          onClick,
          disabled: true,
          disabledTitle: "Install a ready agent first",
          testId: "es-cta",
        }}
      />,
    );
    const cta = screen.getByTestId("es-cta") as HTMLButtonElement;
    expect(cta.disabled).toBe(true);
    expect(cta.getAttribute("title")).toBe("Install a ready agent first");
    fireEvent.click(cta);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders the bare card (no aside) by default", () => {
    render(<EmptyState icon="📝" title="No tasks yet" testId="es" />);
    expect(screen.getByTestId("es").closest("aside")).toBeNull();
  });

  it("wraps the card in the detail-pane aside when asDetailPane is true", () => {
    render(<EmptyState icon="📝" title="No tasks yet" testId="es" asDetailPane />);
    const aside = screen.getByTestId("es").closest("aside");
    expect(aside).toBeTruthy();
    expect(aside?.classList.contains("tasks-pane__detail")).toBe(true);
    expect(aside?.classList.contains("tasks-pane__detail--empty")).toBe(true);
  });
});
