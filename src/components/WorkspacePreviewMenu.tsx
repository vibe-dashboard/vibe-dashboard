import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowSquareOutIcon, GearIcon } from '@phosphor-icons/react';
import {
  IconWorld,
  IconPencil,
  IconRefresh,
  IconTerminal2,
} from '@tabler/icons-react';
import {
  PreviewSlotDialog,
  previewSlotApiPath,
  previewSlotRequest,
} from './PreviewSlotDialog';
import type {
  PreviewSlot,
  WorkspaceRunConfigsResponse,
} from '../server/vk-client';

export function enabledPreviewSlots(
  data: WorkspaceRunConfigsResponse | null,
): PreviewSlot[] {
  return (data?.preview_slots ?? []).filter((slot) => slot.enabled);
}

export function WorkspacePreviewMenu({
  workspaceId,
  onConfigure,
}: {
  workspaceId: string;
  onConfigure: () => void;
}) {
  const [data, setData] = useState<WorkspaceRunConfigsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [dialog, setDialog] = useState<{
    kind: 'edit' | 'logs';
    slot: PreviewSlot;
  } | null>(null);
  const [pendingSlotId, setPendingSlotId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/internal/preview/workspaces/${encodeURIComponent(workspaceId)}/run-configs`,
      );
      if (!response.ok) throw new Error('Preview slots could not be loaded');
      setData((await response.json()) as WorkspaceRunConfigsResponse);
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    setDialog(null);
    setNotice(null);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('pointerdown', closeOnPointerDown);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  const slots = enabledPreviewSlots(data);

  async function restartSlot(slot: PreviewSlot) {
    setPendingSlotId(slot.id);
    setNotice(null);
    try {
      await previewSlotRequest(
        `${previewSlotApiPath(workspaceId, slot.id)}/restart`,
        { method: 'POST' },
      );
      setNotice(`Restarted ${slot.title}.`);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setPendingSlotId(null);
    }
  }

  function openDialog(kind: 'edit' | 'logs', slot: PreviewSlot) {
    setIsOpen(false);
    setDialog({ kind, slot });
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-label="Preview slots"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className="flex cursor-pointer items-center text-default-500 transition-colors hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-focus"
      >
        <IconWorld className="size-icon-base" aria-hidden="true" />
      </button>
      {isOpen ? (
        <div
          role="menu"
          className="absolute bottom-full right-0 z-[10000] mb-half max-h-[60vh] min-w-64 overflow-y-auto rounded-sm border border-divider bg-content1 py-half shadow-md"
        >
          <div className="px-base py-half text-xs font-medium text-default-500">
            Preview slots
          </div>
          {isLoading ? <MenuStatus>Loading…</MenuStatus> : null}
          {!isLoading && error ? (
            <MenuButton onClick={() => void refresh()}>
              {error} — Retry
            </MenuButton>
          ) : null}
          {!isLoading && !error && slots.length === 0 ? (
            <MenuStatus>No preview slots configured</MenuStatus>
          ) : null}
          {notice ? (
            <div role="status" className="px-base py-half text-sm text-foreground">
              {notice}
            </div>
          ) : null}
          {!isLoading && !error
            ? slots.map((slot) => (
                <div
                  key={slot.id}
                  className="mx-half flex items-center gap-half"
                >
                  <a
                    role="menuitem"
                    href={data?.preview_urls?.[slot.id]}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-disabled={!data?.preview_urls?.[slot.id]}
                    className="flex min-w-0 flex-1 items-center gap-base rounded-sm px-base py-half text-left text-sm text-foreground hover:bg-content2 focus:bg-content2 focus:outline-none"
                  >
                    <ArrowSquareOutIcon className="size-icon-xs shrink-0" />
                    <span className="min-w-0">
                      <span className="block truncate">{slot.title}</span>
                      <span className="block truncate text-xs text-default-500">
                        {slot.repo_id} · {slot.slot_slug}
                      </span>
                    </span>
                  </a>
                  <button
                    type="button"
                    role="menuitem"
                    aria-label={`Edit ${slot.title}`}
                    title="Edit script"
                    disabled={pendingSlotId !== null}
                    onClick={() => openDialog('edit', slot)}
                    className="shrink-0 rounded-sm p-half text-default-500 hover:bg-content2 hover:text-foreground disabled:opacity-50"
                  >
                    <IconPencil className="size-icon-xs" />
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    aria-label={`Restart ${slot.title}`}
                    title="Restart server"
                    disabled={pendingSlotId !== null}
                    onClick={() => void restartSlot(slot)}
                    className="shrink-0 rounded-sm p-half text-default-500 hover:bg-content2 hover:text-foreground disabled:opacity-50"
                  >
                    <IconRefresh
                      className={`size-icon-xs ${pendingSlotId === slot.id ? 'animate-spin' : ''}`}
                    />
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    aria-label={`Logs for ${slot.title}`}
                    title="Server logs"
                    disabled={pendingSlotId !== null}
                    onClick={() => openDialog('logs', slot)}
                    className="shrink-0 rounded-sm p-half text-default-500 hover:bg-content2 hover:text-foreground disabled:opacity-50"
                  >
                    <IconTerminal2 className="size-icon-xs" />
                  </button>
                </div>
              ))
            : null}
          <div className="my-half border-t border-divider" />
          <MenuButton onClick={onConfigure}>
            <GearIcon className="size-icon-xs shrink-0" />
            Configure preview slots
          </MenuButton>
        </div>
      ) : null}
      {dialog ? (
        <PreviewSlotDialog
          key={`${workspaceId}:${dialog.slot.id}:${dialog.kind}`}
          workspaceId={workspaceId}
          slot={dialog.slot}
          kind={dialog.kind}
          config={data?.run_configs.find(
            (config) => config.id === dialog.slot.run_config_id,
          )}
          onClose={() => {
            setDialog(null);
            menuRef.current?.querySelector('button')?.focus();
          }}
          onChanged={(message) => {
            setNotice(message);
            setIsOpen(true);
            void refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function MenuButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className="mx-half flex w-[calc(100%-0.5rem)] items-center gap-base rounded-sm px-base py-half text-left text-sm text-foreground hover:bg-content2 focus:bg-content2 focus:outline-none"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function MenuStatus({ children }: { children: React.ReactNode }) {
  return <div className="px-base py-half text-sm text-default-500">{children}</div>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
