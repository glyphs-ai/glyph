import { Component, type ErrorInfo, type ReactNode } from "react";

export interface ErrorBoundaryProps {
  /** Wrapped subtree; isolated from sibling subtrees on render error. */
  children: ReactNode;
  /** Optional label surfaced in the fallback UI and console log (e.g. "Activity tab"). */
  label?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Generic render-error boundary. Catches errors thrown by descendants and
 * renders a contained fallback card in place of the crashed subtree,
 * leaving sibling subtrees and the app shell mounted. Recovery is by
 * remount — the user navigates away or reloads. There is no reset button
 * because the in-flight state of the wrapped subtree (data fetches,
 * timers) is opaque to the boundary; a blind reset would leak handlers.
 *
 * Used as the page-level wrapper around the route outlet so a crash in
 * one tab does not blank the whole dashboard.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface the crash in the browser console for debugging; the user-
    // facing fallback only shows error.message to keep the card compact.
    const tag = this.props.label ? ` [${this.props.label}]` : "";
    console.error(`ErrorBoundary${tag}:`, error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error !== null) {
      const where = this.props.label ? ` in ${this.props.label}` : "";
      return (
        <div className="error-boundary-fallback" role="alert">
          <h2 className="error-boundary-fallback__title">Something went wrong{where}.</h2>
          <p className="error-boundary-fallback__hint muted">
            The error has been logged to the browser console. Reload the page to recover.
          </p>
          <details className="error-boundary-fallback__details">
            <summary>Error details</summary>
            <pre className="error-boundary-fallback__pre">{this.state.error.message}</pre>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}
