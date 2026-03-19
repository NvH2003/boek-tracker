import React from "react";

interface AppErrorBoundaryState {
  hasError: boolean;
}

export class AppErrorBoundary extends React.Component<React.PropsWithChildren, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    // Keep a trace in production logs for unexpected render/runtime crashes.
    console.error("App crashed:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="app-crash-fallback">
          <h1>Er ging iets mis</h1>
          <p>De app kon niet goed laden. Probeer de pagina te vernieuwen.</p>
          <button
            type="button"
            className="primary-button"
            onClick={() => window.location.reload()}
          >
            Pagina vernieuwen
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

