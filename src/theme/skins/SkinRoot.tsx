import type { ReactNode } from "react";
import { SkinRootView } from "./SkinRoot.view";
import { getSkinRuntimeState, type MyneSkinRuntimeOptions } from "./runtime";

export interface SkinRootProps extends MyneSkinRuntimeOptions {
  children?: ReactNode;
  className?: string;
  artifact?: { readonly scope: string; readonly cssText: string };
}

export function SkinRoot({ children, className, artifact, ...options }: SkinRootProps) {
  const runtime = getSkinRuntimeState(options);
  return (
    <SkinRootView className={className} runtime={runtime} artifact={artifact}>
      {children}
    </SkinRootView>
  );
}
