import type { ReactNode } from "react";
import type { MyneSkinRuntimeState } from "./runtime";

export interface SkinRootViewProps {
  children?: ReactNode;
  className?: string;
  runtime: MyneSkinRuntimeState;
}

export function SkinRootView({ children, className, runtime }: SkinRootViewProps) {
  return (
    <div
      className={["myne-theme", className].filter(Boolean).join(" ")}
      data-myne-skin={runtime.skin.id}
      style={runtime.style}
    >
      {children}
    </div>
  );
}
