import type { ReactNode } from "react";
import type { MyneSkinRuntimeState } from "./runtime";

export interface SkinRootViewProps {
  children?: ReactNode;
  className?: string;
  runtime: MyneSkinRuntimeState;
  artifact?: { readonly scope: string; readonly cssText: string };
}

export function SkinRootView({ children, className, runtime, artifact }: SkinRootViewProps) {
  return (
    <div
      className={["myne-theme", className].filter(Boolean).join(" ")}
      data-myne-skin={runtime.skin.id}
      {...(artifact ? { "data-myne-package-scope": artifact.scope } : {})}
      style={runtime.style}
    >
      {artifact && <style data-myne-compiled-artifact={artifact.scope}>{artifact.cssText}</style>}
      {children}
    </div>
  );
}
