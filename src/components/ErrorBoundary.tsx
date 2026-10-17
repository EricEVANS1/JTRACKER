import React from 'react';
import { AlertTriangle, RefreshCcw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  // 'page' keeps the app shell (sidebar) usable and shows the error in the
  // content area; 'app' is the last resort for crashes outside a page.
  variant?: 'page' | 'app';
  // Changing this clears the error, e.g. the route path, so moving to
  // another page recovers.
  resetKey?: string;
}

interface State {
  error: Error | null;
  resetKey?: string;
}

// Shows a recovery screen instead of a blank page when rendering throws.
// The error itself is only shown in development; users get a plain message.
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.resetKey) {
      return { error: null, resetKey: props.resetKey };
    }

    return null;
  }

  componentDidCatch(error: Error) {
    console.error('[JTracker] Page crashed:', error.name);
  }

  private retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const isPage = this.props.variant !== 'app';

    return (
      <div
        role="alert"
        className={isPage ? 'flex justify-center py-12' : 'min-h-screen bg-slate-50 flex items-center justify-center px-4'}
      >
        <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50">
            <AlertTriangle size={22} className="text-amber-600" />
          </div>

          <h1 className="mb-2 text-xl font-bold text-slate-900">
            {isPage ? 'This page ran into a problem' : 'JTracker ran into a problem'}
          </h1>
          <p className="mb-6 text-sm text-slate-500">
            Your saved data is safe. Try again, or reload the page if the problem continues.
          </p>

          {import.meta.env.DEV && (
            <pre className="mb-6 max-h-40 overflow-auto rounded-lg bg-slate-50 p-3 text-left text-xs text-slate-600">
              {error.message}
            </pre>
          )}

          <div className="flex flex-col justify-center gap-2 sm:flex-row">
            <button
              onClick={this.retry}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 transition"
            >
              <RefreshCcw size={15} />
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
            >
              Reload page
            </button>
            {isPage ? null : (
              <a
                href="/dashboard"
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
              >
                Go to dashboard
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }
}
