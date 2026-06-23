import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Segmented, type SegmentedOption } from "../../../src/components/common/Segmented";

afterEach(() => cleanup());

const options: SegmentedOption<"a" | "b" | "c">[] = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta", count: 5 },
  { value: "c", label: "Gamma" },
];

describe("Segmented", () => {
  it("renders all options", () => {
    render(<Segmented options={options} value="a" onChange={() => {}} ariaLabel="test" />);
    expect(screen.getByRole("tab", { name: /Alpha/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Beta/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Gamma/ })).toBeTruthy();
  });

  it("click fires onChange with the option value", () => {
    const onChange = vi.fn();
    render(<Segmented options={options} value="a" onChange={onChange} ariaLabel="test" />);
    fireEvent.click(screen.getByRole("tab", { name: /Beta/ }));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("ArrowRight moves to next option", () => {
    const onChange = vi.fn();
    render(<Segmented options={options} value="a" onChange={onChange} ariaLabel="test" />);
    const tablist = screen.getByRole("tablist");
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("ArrowLeft wraps to last option from first", () => {
    const onChange = vi.fn();
    render(<Segmented options={options} value="a" onChange={onChange} ariaLabel="test" />);
    const tablist = screen.getByRole("tablist");
    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith("c");
  });

  it("Home jumps to first, End jumps to last", () => {
    const onChange = vi.fn();
    render(<Segmented options={options} value="b" onChange={onChange} ariaLabel="test" />);
    const tablist = screen.getByRole("tablist");
    fireEvent.keyDown(tablist, { key: "Home" });
    expect(onChange).toHaveBeenCalledWith("a");
    onChange.mockClear();
    fireEvent.keyDown(tablist, { key: "End" });
    expect(onChange).toHaveBeenCalledWith("c");
  });

  it("aria-selected toggles correctly", () => {
    const { rerender } = render(
      <Segmented options={options} value="a" onChange={() => {}} ariaLabel="test" />,
    );
    expect(screen.getByRole("tab", { name: /Alpha/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: /Beta/ }).getAttribute("aria-selected")).toBe("false");

    rerender(<Segmented options={options} value="b" onChange={() => {}} ariaLabel="test" />);
    expect(screen.getByRole("tab", { name: /Alpha/ }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("tab", { name: /Beta/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("count badge renders when present", () => {
    render(<Segmented options={options} value="a" onChange={() => {}} ariaLabel="test" />);
    const betaTab = screen.getByRole("tab", { name: /Beta/ });
    const badge = betaTab.querySelector(".segmented__count");
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toBe("5");
  });

  it("count badge omitted when undefined", () => {
    render(<Segmented options={options} value="a" onChange={() => {}} ariaLabel="test" />);
    const alphaTab = screen.getByRole("tab", { name: /Alpha/ });
    expect(alphaTab.querySelector(".segmented__count")).toBeNull();
  });
});
