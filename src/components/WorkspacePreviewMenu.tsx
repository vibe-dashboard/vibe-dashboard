import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowSquareOutIcon, GearIcon } from "@phosphor-icons/react";
import { IconWorld } from "@tabler/icons-react";
import type {
  PreviewSlot,
  WorkspaceRunConfigsResponse,
} from "../server/vk-client";

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
  const menuRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/internal/preview/workspaces/${encodeURIComponent(workspaceId)}/run-configs`,
      );
      if (!response.ok) throw new Error("Preview slots could not be loaded");
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
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  const slots = enabledPreviewSlots(data);

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-label="Preview slots"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className="flex cursor-pointer items-center text-low transition-colors hover:text-normal focus:outline-none focus-visible:ring-1 focus-visible:ring-brand"
      >
        <IconWorld className="size-icon-base" aria-hidden="true" />
      </button>
      {isOpen ? (
        <div
          role="menu"
          className="absolute bottom-full right-0 z-[10000] mb-half max-h-[60vh] min-w-64 overflow-y-auto rounded-sm border border-border bg-panel py-half shadow-md"
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
                <a
                  key={slot.id}
                  role="menuitem"
                  href={data?.preview_urls?.[slot.id]}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-disabled={!data?.preview_urls?.[slot.id]}
                  className="mx-half flex w-[calc(100%-0.5rem)] items-center gap-base rounded-sm px-base py-half text-left text-sm text-high hover:bg-secondary focus:bg-secondary focus:outline-none"
                >
                  <ArrowSquareOutIcon className="size-icon-xs shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate">{slot.title}</span>
                    <span className="block truncate text-xs text-low">
                      {slot.repo_id} · {slot.slot_slug}
                    </span>
                  </span>
                </a>
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
