import type { ReactNode } from "react";
import type { AppHooksV1 } from "../app-hooks/AppHooks";
import { SkinRoot, migrateSkinState } from "../theme/skins";

export interface GlobalAppearanceThemeProps {
  appHooks: AppHooksV1;
  children?: ReactNode;
}

export function GlobalAppearanceTheme({
  appHooks,
  children,
}: GlobalAppearanceThemeProps) {
  const appearance = appHooks.modules.get("myne.appearance").useSkinEditor();
  const value = appearance.available ? appearance.value : undefined;
  const skinState = value?.snapshot
    ? migrateSkinState(value.snapshot.value)
    : undefined;

  return (
    <SkinRoot
      artifact={value?.artifact}
      className="h-full min-h-full"
      state={skinState}
    >
      {children}
    </SkinRoot>
  );
}
