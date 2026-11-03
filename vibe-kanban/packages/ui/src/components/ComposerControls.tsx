import {
  createContext,
  useContext,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { SlidersHorizontalIcon, WrenchIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';
import { ToolbarIconButton } from './Toolbar';
import { useComposerSheet } from './ComposerSheet';

const ControlsContext = createContext(false);

export function ComposerDesktop({
  children,
  enabled = true,
}: {
  children: ReactNode;
  enabled?: boolean;
}) {
  const { mobile } = useComposerSheet();
  return mobile && enabled ? null : children;
}

export function ComposerTool({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const inControls = useContext(ControlsContext);
  if (!inControls) return children;
  return (
    <div
      className="composer-tool"
      style={
        { '--composer-tool-label': JSON.stringify(label) } as CSSProperties
      }
    >
      {children}
    </div>
  );
}

export function ComposerControls({
  kind,
  children,
}: {
  kind: 'tools' | 'settings';
  children: ReactNode;
}) {
  const { t } = useTranslation('common');
  const label = t(`composer.${kind}`);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <ToolbarIconButton
          type="button"
          icon={kind === 'settings' ? SlidersHorizontalIcon : WrenchIcon}
          aria-label={label}
          title={label}
          className="size-11 shrink-0 rounded-sm"
        />
      </PopoverTrigger>
      <PopoverContent aria-label={label} className="composer-controls-panel">
        <h2 className="mb-base text-base font-medium">{label}</h2>
        <ControlsContext.Provider value>
          <div className="flex flex-col gap-base">{children}</div>
        </ControlsContext.Provider>
      </PopoverContent>
    </Popover>
  );
}
