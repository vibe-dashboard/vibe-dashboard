import type { KeyboardEvent } from "react";
import type {
  SpacesOverviewTabGroup,
  SpacesOverviewViewActions,
  SpacesOverviewViewModel,
  SpacesOverviewWorkspaceState,
  TabGroupWithSpace,
} from "./SpacesOverview.contracts";
import { formatRelativeTime, Pagination } from "./workspaceList.view";

export function TabGroupRow({
  space,
  tg,
  onNavigate,
  timeLabel,
  label,
}: {
  space: { id: string; name: string };
  tg: SpacesOverviewTabGroup;
  onNavigate: () => void;
  timeLabel?: string | undefined;
  label?: string | undefined;
}) {
  return (
    <button
      onClick={onNavigate}
      className="w-full flex items-start gap-3 px-4 py-2.5 rounded-lg border transition-colors group text-left myne-row"
    >
      <div className="min-w-0 flex-1">
        <span
          className="text-sm font-medium break-words block myne-text myne-text--primary"
        >
          {label ?? tg.label}
        </span>
        <span
          className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs myne-text myne-text--muted"
        >
          <span>{space.name}</span>
          <span>
            {tg.tabs.length} view{tg.tabs.length !== 1 ? "s" : ""}
            {tg.pairs.length > 0 &&
              ` / ${tg.pairs.length} pair${tg.pairs.length !== 1 ? "s" : ""}`}
          </span>
          {timeLabel && <span>{timeLabel}</span>}
        </span>
      </div>
      <svg
        className="mt-1 w-3.5 h-3.5 transition-colors shrink-0 myne-icon myne-icon--chevron"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 5l7 7-7 7"
        />
      </svg>
    </button>
  );
}


// ── Recent Craft ───────────────────────────────────────────────────────

export function StarredTabGroups({
  items,
  onNavigateToTabGroup,
  tabGroupDisplayLabelById,
}: {
  items: TabGroupWithSpace[];
  onNavigateToTabGroup: (spaceId: string, tabGroupId: string) => void;
  tabGroupDisplayLabelById: Map<string, string>;
}) {
  const starred = items;

  if (starred.length === 0) return null;

  return (
    <div className="mb-8" data-myne-slot="starred-craft">
      <h2 className="text-lg font-semibold mb-3 myne-text myne-text--primary">
        Starred
      </h2>
      <div className="space-y-1">
        {starred.map(({ space, tg }) => (
          <TabGroupRow
            key={tg.id}
            space={space}
            tg={tg}
            onNavigate={() => onNavigateToTabGroup(space.id, tg.id)}
            label={tabGroupDisplayLabelById.get(tg.id)}
          />
        ))}
      </div>
    </div>
  );
}

export function RecentSessionsSection({
  model,
  actions,
}: {
  model: SpacesOverviewViewModel;
  actions: SpacesOverviewViewActions;
}) {
  const {
    workspace,
    currentSessionId,
    expandedSessionId,
    editingSessionId,
    sessionNameDraft,
    sortedSessions,
  } = model;

  if (sortedSessions.length === 0) return null;

  return (
    <div className="mb-8" data-myne-slot="recent-sessions">
      <div className="flex items-center justify-between mb-3 gap-3">
        <h2 className="text-lg font-semibold myne-text myne-text--primary">
          All Voyages
        </h2>
        <button
          onClick={actions.startNewSession}
          className="px-3 py-1.5 rounded text-xs font-medium border transition-colors myne-button"
        >
          New Voyage
        </button>
      </div>
      <div className="space-y-1">
        {sortedSessions.map((session) => {
          const space = workspace.spaces.find((item) => item.id === session.activeSpaceId);
          const tg = workspace.tabGroups.find((item) => item.id === session.activeTabGroupId);

          const sessionName =
            session.name?.trim() ||
            tg?.label ||
            session.slug ||
            'Saved voyage';
          const sessionLocation =
            space && tg
              ? `${space.name} / ${tg.label}`
              : 'Recoverable voyage — saved craft is no longer available';
          const isExpanded = expandedSessionId === session.id;
          const sessionTabGroupIds =
            session.voyageEntries?.map((entry) => entry.tabGroupId) ||
            session.visitedTabGroupIds;
          const tabGroups = sessionTabGroupIds
            .map((tabGroupId, index) => {
              const tabGroup = workspace.tabGroups.find((item) => item.id === tabGroupId);
              if (!tabGroup) return null;
              const ownerSpace = workspace.spaces.find((item) =>
                item.tabGroupIds.includes(tabGroupId),
              );
              if (!ownerSpace) return null;
              return { tabGroup: tabGroup, space: ownerSpace, key: `${tabGroupId}-${index}` };
            })
            .filter(
              (
                item,
              ): item is {
                tabGroup: SpacesOverviewTabGroup;
                space: SpacesOverviewWorkspaceState['spaces'][number];
                key: string;
              } =>
                item != null,
            );

          return (
            <div
              key={session.id}
              className="rounded-lg border overflow-hidden myne-card"
            >
              <div
                className="flex flex-col gap-2 px-4 py-2.5 cursor-pointer sm:flex-row sm:items-start"
                onClick={() => actions.resumeSession(session.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    actions.resumeSession(session.id);
                  }
                }}
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <button
                    type="button"
                    className="mt-0.5 transition-colors shrink-0 myne-button myne-button--quiet"
                    aria-label={isExpanded ? 'Collapse voyage' : 'Expand voyage'}
                    onClick={(event) => {
                      event.stopPropagation();
                      actions.toggleExpandedSession(session.id);
                    }}
                  >
                    {isExpanded ? '▾' : '▸'}
                  </button>
                  <div className="min-w-0 flex-1 text-left">
                  {editingSessionId === session.id ? (
                    <input
                      type="text"
                      value={sessionNameDraft}
                      onChange={(event) => actions.setSessionNameDraft(event.target.value)}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === 'Enter' && sessionNameDraft.trim()) {
                          actions.submitRenameSession(session.id);
                        }
                        if (event.key === 'Escape') {
                          actions.cancelRenameSession();
                        }
                      }}
                      onBlur={() => {
                        actions.submitRenameSession(session.id);
                      }}
                      className="w-full rounded border px-2 py-1 text-sm myne-text myne-text--primary"
                      autoFocus
                    />
                  ) : (
                    <>
                      <span
                        className="text-sm font-medium break-words block myne-text myne-text--primary"
                      >
                        {sessionName}
                      </span>
                      <span
                        className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs myne-text myne-text--muted"
                      >
                        <span>{sessionLocation}</span>
                        <span>{formatRelativeTime(session.updatedAt)}</span>
                        {session.id === currentSessionId && (
                          <span className="myne-status--accent">
                            Current
                          </span>
                        )}
                      </span>
                    </>
                  )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-2 pl-6 sm:pl-0 sm:justify-end">
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      actions.startRenameSession(session.id, sessionName);
                    }}
                    className="text-xs shrink-0 myne-button myne-button--quiet"
                  >
                    Rename
                  </button>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      if (
                        confirm(
                          `Delete voyage "${sessionName}"? This won't delete any spaces or craft.`,
                        )
                      ) {
                        actions.deleteSession(session.id);
                      }
                    }}
                    className="text-xs shrink-0 myne-button myne-button--danger"
                  >
                    Delete
                  </button>
                </div>
              </div>
              {isExpanded && (
                <div className="border-t px-4 py-3 space-y-1 ">
                  {tabGroups.length > 0 ? (
                    tabGroups.map(({ tabGroup, space: ownerSpace, key }) => (
                      <button
                        key={key}
                        onClick={() => actions.navigateToTabGroup(ownerSpace.id, tabGroup.id)}
                        className="w-full flex items-start justify-between gap-3 px-3 py-2 rounded text-left myne-row"
                      >
                        <div className="min-w-0 flex-1">
                          <div
                            className="text-sm break-words myne-text myne-text--primary"
                          >
                            {tabGroup.label}
                            {tabGroup.id === session.activeTabGroupId ? (
                              <span className="ml-2 text-xs myne-status--accent">
                                Active
                              </span>
                            ) : null}
                          </div>
                          <div
                            className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs myne-text myne-text--muted"
                          >
                            {ownerSpace.name}
                            <span>
                              {tabGroup.tabs.length} view{tabGroup.tabs.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="text-xs myne-text myne-text--muted">
                      No available craft found for this voyage. Resume will recover it with a fallback craft.
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function RecentlyVisitedTabGroups({
  items,
  page,
  totalPages,
  onPageChange,
  onNavigateToTabGroup,
  tabGroupDisplayLabelById,
}: {
  items: TabGroupWithSpace[];
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onNavigateToTabGroup: (spaceId: string, tabGroupId: string) => void;
  tabGroupDisplayLabelById: Map<string, string>;
}) {
  if (items.length === 0) return null;

  return (
    <div className="mb-8" data-myne-slot="recently-visited-craft">
      <h2 className="text-lg font-semibold mb-3 myne-text myne-text--primary">
        Recently Visited
      </h2>
      <div className="space-y-1">
        {items.map(({ space, tg }) => (
          <TabGroupRow
            key={tg.id}
            space={space}
            tg={tg}
            onNavigate={() => onNavigateToTabGroup(space.id, tg.id)}
            timeLabel={
              tg.lastVisitedAt
                ? formatRelativeTime(tg.lastVisitedAt)
                : undefined
            }
            label={tabGroupDisplayLabelById.get(tg.id)}
          />
        ))}
      </div>
      <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
    </div>
  );
}

export function RecentlyCreatedTabGroups({
  items,
  page,
  totalPages,
  onPageChange,
  onNavigateToTabGroup,
  tabGroupDisplayLabelById,
}: {
  items: TabGroupWithSpace[];
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onNavigateToTabGroup: (spaceId: string, tabGroupId: string) => void;
  tabGroupDisplayLabelById: Map<string, string>;
}) {
  if (items.length === 0) return null;

  return (
    <div className="mb-8" data-myne-slot="recently-created-craft">
      <h2 className="text-lg font-semibold mb-3 myne-text myne-text--primary">
        Recently Created
      </h2>
      <div className="space-y-1">
        {items.map(({ space, tg }) => (
          <TabGroupRow
            key={tg.id}
            space={space}
            tg={tg}
            onNavigate={() => onNavigateToTabGroup(space.id, tg.id)}
            timeLabel={
              tg.createdAt ? formatRelativeTime(tg.createdAt) : undefined
            }
            label={tabGroupDisplayLabelById.get(tg.id)}
          />
        ))}
      </div>
      <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
    </div>
  );
}

// ── Spaces Section ──────────────────────────────────────────────────────────

export function SpacesSection({
  spacesWithTabGroups,
  onNavigateToTabGroup,
  tabGroupDisplayLabelById,
}: {
  spacesWithTabGroups: Array<{
    space: SpacesOverviewWorkspaceState["spaces"][number];
    tabGroups: SpacesOverviewTabGroup[];
  }>;
  onNavigateToTabGroup: (spaceId: string, tabGroupId: string) => void;
  tabGroupDisplayLabelById: Map<string, string>;
}) {
  if (spacesWithTabGroups.length === 0) return null;

  return (
    <div data-myne-slot="spaces-list">
      <h2 className="text-lg font-semibold mb-3 myne-text myne-text--primary">
        All Spaces
      </h2>
      <div className="space-y-1">
        {spacesWithTabGroups.map(({ space, tabGroups }) => (
          <div key={space.id} className="myne-section">
            {/* Space header row */}
            <div className="flex items-center gap-3 px-4 py-2 mt-3 first:mt-0">
              <span className="text-sm font-semibold myne-text myne-text--secondary">
                {space.name}
              </span>
              <span className="text-xs myne-text myne-text--muted">
                {tabGroups.length} craft
              </span>
            </div>
            {/* Tab group rows */}
            {tabGroups.map((tg) => (
              <button
                key={tg.id}
                onClick={() => onNavigateToTabGroup(space.id, tg.id)}
                className="w-full flex items-start gap-3 px-4 py-2.5 rounded-lg border transition-colors group text-left myne-row"
              >
                <div className="min-w-0 flex-1">
                  <span
                    className="text-sm font-medium break-words block myne-text myne-text--primary"
                  >
                    {tabGroupDisplayLabelById.get(tg.id) ?? tg.label}
                  </span>
                  <span
                    className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs myne-text myne-text--muted"
                  >
                    <span>
                      {tg.tabs.length} view{tg.tabs.length !== 1 ? "s" : ""}
                    </span>
                    {tg.pairs.length > 0 && (
                      <span>
                        {tg.pairs.length} pair{tg.pairs.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </span>
                </div>
                <svg
                  className="mt-1 w-3.5 h-3.5 transition-colors shrink-0 myne-icon myne-icon--chevron"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
