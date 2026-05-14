/**
 * Top-level React error boundary. Without one, a thrown error inside
 * any component (e.g. a bad data shape, a broken third-party hook)
 * white-screens the entire app — users see a blank page and assume
 * the product is broken.
 *
 * With this wrapper, the user sees a friendly message + a way out
 * (reload or go home). The error is logged to console so we can
 * see it via Railway's runtime logs / the browser devtools.
 *
 * Class component because React still requires class form for error
 * boundaries — there's no hook equivalent as of React 19.
 */
import { Component, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { hasError: boolean; error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }): void {
    // Surface to browser console + (eventually) any error-monitoring
    // SDK that hooks console.error. Stays simple — we deliberately
    // don't post to /tis-api here because the API itself could be
    // the source of the failure.
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", error, info?.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = "/";
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="max-w-md w-full text-center space-y-6">
            <div className="text-xs uppercase tracking-widest text-red-600">
              Something went wrong
            </div>
            <h1 className="text-2xl font-bold">
              The app hit an unexpected error.
            </h1>
            <p className="text-sm text-muted-foreground">
              Sorry — reloading the page usually clears it. If it keeps
              happening, drop us a note at{" "}
              <a
                href="mailto:support@simpleimpactstudies.com"
                className="text-blue-600 hover:underline"
              >
                support@simpleimpactstudies.com
              </a>
              .
            </p>
            <div className="flex gap-2 justify-center pt-2">
              <button
                type="button"
                onClick={this.handleReload}
                className="px-4 py-2 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700"
              >
                Reload
              </button>
              <button
                type="button"
                onClick={this.handleGoHome}
                className="px-4 py-2 text-sm font-semibold rounded-md border hover:bg-accent"
              >
                Go home
              </button>
            </div>
            {process.env.NODE_ENV !== "production" && this.state.error && (
              <pre className="text-left text-xs bg-gray-100 p-3 rounded overflow-auto max-h-64 mt-4">
                {this.state.error.message}
                {"\n"}
                {this.state.error.stack}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
