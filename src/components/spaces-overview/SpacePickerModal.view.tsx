import type {
  DashboardWorkspace,
  SpacesOverviewWorkspaceState,
} from "./SpacesOverview.contracts";

export function SpacePickerModal({
  workspace: ws,
  targetWorkspace,
  onSelect,
  onClose,
  pendingSpaceId,
  actionError,
  onRetry,
}: {
  workspace: SpacesOverviewWorkspaceState;
  targetWorkspace: DashboardWorkspace;
  onSelect: (spaceId: string) => void;
  onClose: () => void;
  pendingSpaceId?: string | null;
  actionError?: string | null;
  onRetry?: () => void;
}) {
  const spaces = ws.spaces;
  const isPending = Boolean(pendingSpaceId);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center "
      data-myne-slot="space-picker-modal"
      role="presentation"
      onClick={() => {
        if (!isPending) onClose();
      }}
    >
      <div
        aria-labelledby="myne-space-picker-title"
        aria-modal="true"
        className="border rounded-xl shadow-2xl w-full max-w-sm mx-4 myne-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        <div className="px-5 pt-5 pb-3">
          <h3
            className="text-sm font-semibold myne-text myne-text--primary"
            id="myne-space-picker-title"
          >
            Open craft in space
          </h3>
          <p className="mt-1 truncate text-xs myne-text myne-text--muted">
            {targetWorkspace.name}
          </p>
        </div>
        {actionError && (
          <div
            role="alert"
            className="mx-5 mb-3 rounded-md border p-3 text-xs myne-status--danger"
          >
            <div>{actionError}</div>
            {onRetry && (
              <button
                className="mt-2 rounded border px-2 py-1 font-medium transition-colors myne-button myne-button--danger"
                onClick={onRetry}
              >
                Retry
              </button>
            )}
          </div>
        )}
        <div className="px-3 pb-3 max-h-64 overflow-y-auto">
          {spaces.length === 0 ? (
            <p
              className="px-2 py-4 text-center text-xs myne-text myne-text--muted"
            >
              No spaces available. Create a space first.
            </p>
          ) : (
            <div className="space-y-1">
              {spaces.map((space) => (
                <button
                  key={space.id}
                  onClick={() => onSelect(space.id)}
                  disabled={isPending}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-left disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent myne-row"
                >
                  <span className="text-sm myne-text myne-text--primary">
                    {space.name}
                  </span>
                  {pendingSpaceId === space.id && (
                    <span className="text-xs myne-status--accent">
                      Opening…
                    </span>
                  )}
                  <span className="ml-auto text-xs myne-text myne-text--muted">
                    {
                      ws.tabGroups.filter((tg) =>
                        space.tabGroupIds.includes(tg.id),
                      ).length
                    }{" "}
                    craft
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="px-5 pb-4 pt-2 border-t ">
          <button
            onClick={onClose}
            disabled={isPending}
            className="w-full px-3 py-1.5 rounded text-xs font-medium border transition-colors disabled:cursor-not-allowed disabled:opacity-60 myne-button myne-button--quiet"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
