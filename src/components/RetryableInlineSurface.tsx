import React, { useMemo, useState } from 'react';

class SurfaceErrorBoundary extends React.Component<
  {
    label: string;
    onRetry: () => void;
    children: React.ReactNode;
  },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="alert"
        className="flex h-full items-center justify-center p-6 text-center text-foreground"
      >
        <div>
          <h2 className="font-medium">{this.props.label} unavailable</h2>
          <p className="mt-2 text-sm text-default-500">
            This surface could not be loaded. Try again to reconnect.
          </p>
          <button
            type="button"
            className="mt-4 rounded border border-divider px-3 py-2 text-sm"
            onClick={this.props.onRetry}
          >
            Retry {this.props.label}
          </button>
        </div>
      </div>
    );
  }
}

export function RetryableInlineSurface<P extends object>({
  label,
  load,
  componentProps,
}: {
  label: string;
  load: () => Promise<{ default: React.ComponentType<P> }>;
  componentProps: P;
}) {
  const [attempt, setAttempt] = useState(0);
  const Component = useMemo(() => React.lazy(load), [load, attempt]);

  return (
    <SurfaceErrorBoundary
      key={attempt}
      label={label}
      onRetry={() => setAttempt((value) => value + 1)}
    >
      <React.Suspense
        fallback={
          <div
            role="status"
            className="flex h-full items-center justify-center text-sm text-default-500"
          >
            Loading {label}…
          </div>
        }
      >
        <Component {...componentProps} />
      </React.Suspense>
    </SurfaceErrorBoundary>
  );
}
