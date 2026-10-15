import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowSquareOutIcon,
  GearIcon,
  GlobeIcon,
} from '@phosphor-icons/react';
import type {
  PreviewSlot,
  WorkspaceRunConfigsResponse,
} from '../server/vk-client';

export function enabledPreviewSlots(
  data: WorkspaceRunConfigsResponse | null,
): PreviewSlot[] {
  return (data?.preview_slots ?? []).filter((slot) => slot.enabled);
}

export async function fetchPreviewSlotUrl(
  workspaceId: string,
  previewSlotId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(
    `/internal/preview/workspaces/${encodeURIComponent(workspaceId)}/preview-slots/${encodeURIComponent(previewSlotId)}/url`,
  );
  if (!response.ok) throw new Error(await response.text());
  const result = (await response.json()) as { url?: unknown };
  if (typeof result.url !== 'string' || !result.url) {
    throw new Error('Preview URL response was invalid');
  }
  const url = new URL(result.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Preview URL protocol was invalid');
  }
  return result.url;
}

export async function openPreviewSlotInNewTab(
  workspaceId: string,
  previewSlotId: string,
  openImpl: typeof window.open = window.open.bind(window),
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const opened = openImpl('about:blank', '_blank');
  if (!opened) throw new Error('The browser blocked the preview tab');

  opened.opener = null;
  try {
    opened.document.head.innerHTML = '<meta name="referrer" content="no-referrer">';
    const url = await fetchPreviewSlotUrl(workspaceId, previewSlotId, fetchImpl);
    opened.location.replace(url);
  } catch (error) {
    opened.close();
    throw error;
  }
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
  const menuRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/internal/preview/workspaces/${encodeURIComponent(workspaceId)}/run-configs`,
      );
      if (!response.ok) throw new Error(await response.text());
      setData((await response.json()) as WorkspaceRunConfigsResponse);
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
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

  const openSlot = useCallback(
    async (slotId: string) => {
      setError(null);
      try {
        await openPreviewSlotInNewTab(workspaceId, slotId);
      } catch (nextError) {
        setError(errorMessage(nextError));
      }
    },
    [workspaceId],
  );

  const slots = enabledPreviewSlots(data);

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-label="Preview slots"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className="flex h-9 cursor-pointer list-none items-center gap-half rounded-sm border border-border bg-secondary px-half text-sm text-normal focus:outline-none focus-visible:ring-1 focus-visible:ring-brand sm:px-base [&::-webkit-details-marker]:hidden"
      >
        <GlobeIcon className="size-icon-xs" weight="bold" />
        <span className="hidden max-w-[72px] truncate sm:inline">Preview</span>
      </button>
      {isOpen ? (
        <div
          role="menu"
          className="absolute right-0 z-[10000] mt-half min-w-64 overflow-hidden rounded-sm border border-border bg-panel py-half shadow-md"
        >
          <div className="px-base py-half text-xs font-medium text-low">
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
          {!isLoading && !error
            ? slots.map((slot) => (
                <MenuButton key={slot.id} onClick={() => void openSlot(slot.id)}>
                  <ArrowSquareOutIcon className="size-icon-xs shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate">{slot.title}</span>
                    <span className="block truncate text-xs text-low">
                      {slot.repo_id} · {slot.slot_slug}
                    </span>
                  </span>
                </MenuButton>
              ))
            : null}
          <div className="my-half border-t border-border" />
          <MenuButton onClick={onConfigure}>
            <GearIcon className="size-icon-xs shrink-0" />
            Configure preview slots
          </MenuButton>
        </div>
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
      className="mx-half flex w-[calc(100%-0.5rem)] items-center gap-base rounded-sm px-base py-half text-left text-sm text-high hover:bg-secondary focus:bg-secondary focus:outline-none"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function MenuStatus({ children }: { children: React.ReactNode }) {
  return <div className="px-base py-half text-sm text-low">{children}</div>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
