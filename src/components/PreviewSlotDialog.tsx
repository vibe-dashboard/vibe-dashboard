import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@vibe/ui/components/Dialog';
import { useLogStream } from '@/shared/hooks/useLogStream';
import type { PreviewSlot, RunConfig } from '../server/vk-client';

export function previewSlotApiPath(workspaceId: string, slotId: string) {
  return `/internal/preview/workspaces/${encodeURIComponent(workspaceId)}/preview-slots/${encodeURIComponent(slotId)}`;
}

export async function previewSlotRequest<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, init);
  const result = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      typeof result?.message === 'string'
        ? result.message
        : 'Preview request failed. Please try again.',
    );
  return result as T;
}

export function PreviewSlotDialog({
  workspaceId,
  slot,
  config,
  kind,
  onClose,
  onChanged,
}: {
  workspaceId: string;
  slot: PreviewSlot;
  config?: RunConfig;
  kind: 'edit' | 'logs';
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const [command, setCommand] = useState(config?.command ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [process, setProcess] = useState<{
    processId: string | null;
    message: string | null;
  } | null>(null);
  const path = previewSlotApiPath(workspaceId, slot.id);

  useEffect(() => {
    if (kind !== 'logs') return;
    const controller = new AbortController();
    void previewSlotRequest<{
      processId: string | null;
      message: string | null;
    }>(`${path}/process`, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setProcess(result);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [kind, path]);

  async function mutate(action: 'save' | 'delete') {
    setPending(true);
    setError(null);
    try {
      await previewSlotRequest(
        action === 'save' ? `${path}/script` : path,
        action === 'save'
          ? {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ command }),
            }
          : { method: 'DELETE' },
      );
      onChanged(
        action === 'save'
          ? `Saved ${slot.title}. Restart the slot to run the updated script.`
          : `Deleted ${slot.title}.`,
      );
      onClose();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Preview action failed',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent
        className="max-h-[85vh] overflow-y-auto p-double text-foreground"
        style={{ width: 'min(48rem, calc(100vw - 2rem))', maxWidth: '48rem' }}
      >
        <DialogTitle>
          {kind === 'edit' ? 'Edit preview slot' : 'Preview server logs'}:{' '}
          {slot.title}
        </DialogTitle>
        <DialogDescription className="mt-base">
          {kind === 'edit'
            ? `Edit the ${config?.name ?? 'preview'} run script. Slots sharing this run config use the same script. Saved changes take effect on restart.`
            : 'Live stdout and stderr from the current preview server.'}
        </DialogDescription>
        {error ? (
          <p role="alert" className="mt-base text-sm text-danger">
            {error}
          </p>
        ) : null}
        {kind === 'edit' ? (
          <form
            className="mt-double space-y-base"
            onSubmit={(event) => {
              event.preventDefault();
              void mutate('save');
            }}
          >
            <label className="block text-sm">
              Script
              <textarea
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                disabled={pending || !config}
                rows={12}
                spellCheck={false}
                className="mt-base block w-full rounded-sm border border-divider bg-content2 p-base font-mono text-sm"
              />
            </label>
            {!config ? (
              <p className="text-danger">
                The run config for this slot is unavailable.
              </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-base pt-base">
              <button
                type="button"
                disabled={pending}
                onClick={() => void mutate('delete')}
                className="rounded-sm border border-danger px-base py-half text-sm text-danger disabled:opacity-50"
              >
                Delete preview slot
              </button>
              <div className="flex gap-base">
                <button
                  type="button"
                  disabled={pending}
                  onClick={onClose}
                  className="px-base py-half text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending || !config || !command.trim()}
                  className="rounded-sm bg-primary px-base py-half text-sm text-primary-foreground disabled:opacity-50"
                >
                  {pending ? 'Working…' : 'Save script'}
                </button>
              </div>
            </div>
          </form>
        ) : process?.processId ? (
          <PreviewProcessLogs processId={process.processId} />
        ) : (
          <p role="status" className="mt-double text-sm text-default-500">
            {process?.message ??
              (error ? 'Logs unavailable.' : 'Loading preview process…')}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PreviewProcessLogs({ processId }: { processId: string }) {
  const { logs, error } = useLogStream(processId);
  return (
    <>
      {error ? (
        <p role="alert" className="mt-base text-sm text-danger">
          Log connection failed. Close and reopen this dialog to reconnect.
        </p>
      ) : null}
      <pre
        aria-label="Preview server output"
        className="mt-double max-h-[55vh] overflow-auto whitespace-pre-wrap break-words rounded-sm border border-divider bg-content2 p-base font-mono text-xs"
      >
        {logs.length
          ? logs.map((entry, index) => (
              <span
                key={index}
                className={entry.type === 'STDERR' ? 'text-danger' : undefined}
              >
                {entry.content}
              </span>
            ))
          : 'Waiting for server output…'}
      </pre>
    </>
  );
}
