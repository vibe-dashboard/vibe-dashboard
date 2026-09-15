import type { ReactNode } from "react";
import { SkinRootView } from "./SkinRoot.view";
import { getSkinRuntimeState, type MyneSkinRuntimeOptions } from "./runtime";

export interface SkinRootProps extends MyneSkinRuntimeOptions {
  children?: ReactNode;
  className?: string;
}

export function SkinRoot({ children, className, ...options }: SkinRootProps) {
  const runtime = getSkinRuntimeState(options);
  return (
    <SkinRootView className={className} runtime={runtime}>
      {children}
    </SkinRootView>
  );
}
