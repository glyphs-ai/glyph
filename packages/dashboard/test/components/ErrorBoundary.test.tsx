import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../../src/components/ErrorBoundary";

function Boom({ message = "kaboom" }: { message?: string }): never {
  throw new Error(message);
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Boundary intentionally logs to console.error. Silence it (and the
  // unhandled-render-error noise React itself prints) so the suite output
  // stays readable; assertions still inspect the spy when needed.
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  consoleErrorSpy.mockRestore();
});

describe("<ErrorBoundary />", () => {
  it("renders children unchanged when no descendant throws", () => {
    render(
      <ErrorBoundary>
        <p>fine</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("fine")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders a fallback card when a descendant throws", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    const fallback = screen.getByRole("alert");
    expect(fallback).toBeTruthy();
    expect(fallback.className).toContain("error-boundary-fallback");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain("Something went wrong");
  });

  it("includes the label in the fallback heading when provided", () => {
    render(
      <ErrorBoundary label="Activity tab">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "Something went wrong in Activity tab.",
    );
  });

  it("exposes the error message inside the details disclosure", () => {
    render(
      <ErrorBoundary>
        <Boom message="payload exploded" />
      </ErrorBoundary>,
    );
    expect(screen.getByText("payload exploded").tagName.toLowerCase()).toBe("pre");
  });

  it("logs the crash to console.error tagged with the label", () => {
    render(
      <ErrorBoundary label="page content">
        <Boom message="render fail" />
      </ErrorBoundary>,
    );
    // React itself also logs the error; just confirm at least one of our
    // tagged log entries is present.
    const tagged = consoleErrorSpy.mock.calls.some(
      (call: unknown[]) =>
        typeof call[0] === "string" && call[0].includes("ErrorBoundary [page content]"),
    );
    expect(tagged).toBe(true);
  });

  it("isolates sibling subtrees when only one wrapped child throws", () => {
    render(
      <div>
        <ErrorBoundary label="left">
          <Boom />
        </ErrorBoundary>
        <ErrorBoundary label="right">
          <p>right pane still alive</p>
        </ErrorBoundary>
      </div>,
    );
    expect(screen.getByText("right pane still alive")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain("left");
  });
});
