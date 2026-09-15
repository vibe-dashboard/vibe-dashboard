import type { ReactNode } from "react";

export interface ProtectedAppearanceBoundaryProps {
  readonly children: ReactNode;
  readonly status?: "neutral" | "confirmation" | "warning" | "destructive" | "error" | "disabled";
}

export function ProtectedAppearanceBoundary({ children, status = "neutral" }: ProtectedAppearanceBoundaryProps) {
  return (
    <aside
      id="myne-appearance-recovery"
      className="myne-protected-appearance-controls"
      data-myne-protected="appearance-controls"
      data-myne-protected-status={status}
      role="region"
      aria-label="Appearance safety controls"
      tabIndex={-1}
    >
      {children}
    </aside>
  );
}
