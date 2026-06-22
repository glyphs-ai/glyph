import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FrontmatterTable } from "../../../src/components/catalog/FrontmatterTable.js";

afterEach(() => cleanup());

describe("FrontmatterTable", () => {
  it("renders key-value pairs as table rows", () => {
    const data = { name: "my-skill", version: "1.0.0", scope: "official" };
    render(<FrontmatterTable data={data} />);

    expect(screen.getByText("name")).toBeDefined();
    expect(screen.getByText("my-skill")).toBeDefined();
    expect(screen.getByText("version")).toBeDefined();
    expect(screen.getByText("1.0.0")).toBeDefined();
    expect(screen.getByText("scope")).toBeDefined();
    expect(screen.getByText("official")).toBeDefined();
  });

  it("renders arrays as lists", () => {
    const data = { skills: ["skill-a", "skill-b", "skill-c"] };
    render(<FrontmatterTable data={data} />);

    expect(screen.getByText("skill-a")).toBeDefined();
    expect(screen.getByText("skill-b")).toBeDefined();
    expect(screen.getByText("skill-c")).toBeDefined();
  });

  it("renders nested objects as nested tables", () => {
    const data = { dependencies: { skills: ["a"], mcps: ["b"] } };
    render(<FrontmatterTable data={data} />);

    expect(screen.getByText("dependencies")).toBeDefined();
    expect(screen.getByText("skills")).toBeDefined();
    expect(screen.getByText("mcps")).toBeDefined();
  });

  it("renders null values", () => {
    const data = { optional: null };
    render(<FrontmatterTable data={data} />);

    expect(screen.getByText("null")).toBeDefined();
  });

  it("returns null for empty data", () => {
    const { container } = render(<FrontmatterTable data={{}} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders boolean values as strings", () => {
    const data = { enabled: true, deprecated: false };
    render(<FrontmatterTable data={data} />);

    expect(screen.getByText("true")).toBeDefined();
    expect(screen.getByText("false")).toBeDefined();
  });
});
