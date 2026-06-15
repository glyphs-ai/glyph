import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Ansi } from "../../../src/components/tasks/Ansi";

afterEach(() => cleanup());

describe("<Ansi />", () => {
  it("renders plain text inside a single <code> wrapper", () => {
    const { container } = render(<Ansi>hello world</Ansi>);
    const code = container.querySelector("code");
    expect(code).toBeTruthy();
    expect(code?.textContent).toBe("hello world");
  });

  it("renders an empty <code> when children is the empty string", () => {
    const { container } = render(<Ansi>{""}</Ansi>);
    const code = container.querySelector("code");
    expect(code).toBeTruthy();
    expect(code?.textContent).toBe("");
  });

  it("does not crash on undefined children (preserves the loose string|null|undefined input contract)", () => {
    const { container } = render(<Ansi>{undefined}</Ansi>);
    expect(container.querySelector("code")).toBeTruthy();
    expect(container.textContent).toBe("");
  });

  it("does not crash on null children", () => {
    const { container } = render(<Ansi>{null}</Ansi>);
    expect(container.querySelector("code")).toBeTruthy();
    expect(container.textContent).toBe("");
  });

  it("parses ANSI color escapes into colored spans with no raw escape bytes in the DOM", () => {
    const { container } = render(<Ansi>{"\x1b[31mred\x1b[0m and \x1b[32mgreen\x1b[0m"}</Ansi>);
    expect(container.textContent).not.toContain("\x1b");
    expect(container.textContent).toBe("red and green");
    const red = screen.getByText("red");
    expect(red.tagName.toLowerCase()).toBe("span");
    expect(red.style.color).toBeTruthy();
    const green = screen.getByText("green");
    expect(green.style.color).toBeTruthy();
    expect(green.style.color).not.toBe(red.style.color);
  });

  it("maps SGR decorations to inline styles", () => {
    const { container } = render(
      <Ansi>{"\x1b[1mbold\x1b[0m \x1b[4munder\x1b[0m \x1b[3mital\x1b[0m"}</Ansi>,
    );
    const spans = container.querySelectorAll("span");
    const styles = Array.from(spans).map((s) => ({
      text: s.textContent,
      weight: s.style.fontWeight,
      decoration: s.style.textDecoration,
      fontStyle: s.style.fontStyle,
    }));
    expect(styles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "bold", weight: "bold" }),
        expect.objectContaining({ text: "under", decoration: "underline" }),
        expect.objectContaining({ text: "ital", fontStyle: "italic" }),
      ]),
    );
  });

  it("forwards className to the wrapping <code>", () => {
    const { container } = render(<Ansi className="my-class">x</Ansi>);
    const code = container.querySelector("code");
    expect(code?.className).toBe("my-class");
  });

  it("renders mixed plain + escaped content in document order", () => {
    const { container } = render(<Ansi>{"prefix \x1b[33myellow\x1b[0m suffix"}</Ansi>);
    expect(container.textContent).toBe("prefix yellow suffix");
  });

  it("handles multi-line input including \\n and \\r without throwing", () => {
    const { container } = render(<Ansi>{"line 1\nline 2\rline 3"}</Ansi>);
    expect(container.querySelector("code")).toBeTruthy();
    // Anser collapses the carriage return into clearLine; the residual
    // text content must still contain the three line bodies.
    expect(container.textContent).toContain("line 1");
    expect(container.textContent).toContain("line 2");
    expect(container.textContent).toContain("line 3");
  });
});
