import { type ReactNode } from 'react';
import { ImageIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/cn';
import { Toolbar } from './Toolbar';

export enum VisualVariant {
  NORMAL = 'NORMAL',
  FEEDBACK = 'FEEDBACK',
  EDIT = 'EDIT',
  PLAN = 'PLAN',
}

export interface DropzoneProps {
  getRootProps: () => Record<string, unknown>;
  getInputProps: () => Record<string, unknown>;
  isDragActive: boolean;
}

interface ChatBoxBaseProps {
  // Editor node (provided by frontend)
  editor: ReactNode;

  // Error display
  error?: string | null;

  // Header content (right side - session/executor dropdown)
  headerRight?: ReactNode;

  // Header content (left side - stats)
  headerLeft?: ReactNode;

  // Footer left content (additional toolbar items like attach button)
  footerLeft?: ReactNode;

  // Footer right content (action buttons)
  footerRight: ReactNode;

  // Model selector node (rendered with footer controls)
  modelSelector?: ReactNode;

  // Banner content (queued message indicator, feedback mode indicator)
  banner?: ReactNode;

  // Optional overlay anchored to the bottom-left corner
  bottomLeftOverlay?: ReactNode;

  // visualVariant
  visualVariant: VisualVariant;

  // Whether the workspace is running (shows animated border)
  isRunning?: boolean;

  // Dropzone props for drag-and-drop image uploads
  dropzone?: DropzoneProps;
}

/**
 * Base chat box layout component.
 * Provides shared structure for CreateChatBox and SessionChatBox.
 */
export function ChatBoxBase({
  editor,
  error,
  headerRight,
  headerLeft,
  footerLeft,
  footerRight,
  modelSelector,
  banner,
  bottomLeftOverlay,
  visualVariant,
  isRunning,
  dropzone,
}: ChatBoxBaseProps) {
  const { t } = useTranslation(['common', 'tasks']);

  const isDragActive = dropzone?.isDragActive ?? false;
  const hasHeaderContent = Boolean(headerLeft || headerRight);

  return (
    <div
      {...(dropzone?.getRootProps() ?? {})}
      className={cn(
        'relative flex w-chat max-w-full flex-col rounded-sm border border-divider bg-content1',
        (visualVariant === VisualVariant.FEEDBACK ||
          visualVariant === VisualVariant.EDIT ||
          visualVariant === VisualVariant.PLAN) &&
          'border-primary bg-primary/10',
        isRunning && 'chat-box-running'
      )}
    >
      {dropzone && <input {...dropzone.getInputProps()} />}

      {isDragActive && (
        <div className="absolute inset-0 z-50 flex items-center justify-center rounded-sm border-2 border-dashed border-primary bg-background/80 backdrop-blur-sm pointer-events-none animate-in fade-in-0 duration-150">
          <div className="text-center">
            <div className="mx-auto mb-2 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <ImageIcon className="h-5 w-5 text-primary" />
            </div>
            <p className="text-sm font-medium text-foreground">
              {t('tasks:dropzone.dropImagesHere')}
            </p>
            <p className="text-xs text-default-500 mt-0.5">
              {t('tasks:dropzone.supportedFormats')}
            </p>
          </div>
        </div>
      )}
      {/* Error alert */}
      {error && (
        <div className="bg-danger/10 border-b border-divider px-double py-base">
          <p className="text-danger text-sm">{error}</p>
        </div>
      )}

      {/* Banner content (queued indicator, feedback mode, etc.) */}
      {banner}

      {/* Header - Stats and selector */}
      {visualVariant === VisualVariant.NORMAL && hasHeaderContent && (
        <div className="flex flex-col items-stretch gap-base border-b px-base py-base sm:flex-row sm:items-center">
          <div className="flex flex-1 items-center gap-base text-sm min-w-0 overflow-hidden">
            {headerLeft}
          </div>
          <Toolbar className="w-full justify-end gap-[9px] sm:w-auto">
            {headerRight}
          </Toolbar>
        </div>
      )}

      {/* Editor area */}
      <div className="flex flex-col gap-plusfifty px-base py-base rounded-md">
        {editor}

        {/* Footer - Controls */}
        <div className="flex items-end justify-between gap-base">
          <Toolbar className="flex-1 min-w-0 flex-wrap !gap-half">
            {modelSelector}
            {footerLeft}
          </Toolbar>
          <div className="flex shrink-0 gap-base">{footerRight}</div>
        </div>
      </div>

      {bottomLeftOverlay && (
        <div className="absolute bottom-base left-base z-10">
          {bottomLeftOverlay}
        </div>
      )}
    </div>
  );
}
