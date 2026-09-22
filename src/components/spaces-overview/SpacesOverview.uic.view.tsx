import { DefaultPageHeader, DefaultSpacesOverviewLayout, defaultSpacesOverviewUI } from "./DefaultSpacesOverview.view";
import type { SpacesOverviewComponentProps, TabGroupWithSpace } from "./SpacesOverview.contracts";
import type { SpacesOverviewSlotProps } from "./SpacesOverview.slots";
import { formatRelativeTime } from "./workspaceList.view";
import { MyneHeading, MyneText } from "../../theme/skins";
import { spacesOverviewPageHeaderUICProof, validateUICXml } from "../../uic/trustedComponents";

export const spacesOverviewUICLayoutXml = `<uic:spaceOverviewPage xmlns:uic="https://vibedashboard.dev/uic/xml/v1" artifactVersion="1">
  <uic:css><![CDATA[:uic-scope { --myne-slot-page-header-gap: 1rem; }]]></uic:css>
  <uic:pageHeader title="{model.title}" subtitle="{model.subtitle}">
    <uic:slot name="actions">
      <uic:pageHeaderAction label="Start voyage" />
    </uic:slot>
  </uic:pageHeader>
  <uic:recentSessions />
  <uic:starredCraft uic:on-activate="spaces.navigateToCraft" />
  <uic:runningDevServers />
  <uic:recentlyVisitedCraft />
  <uic:recentlyCreatedCraft />
  <uic:workspaceList />
  <uic:spaces />
  <uic:spacePicker />
</uic:spaceOverviewPage>`;

export function SpacesOverviewUICPageHeaderProof({ xml = spacesOverviewUICLayoutXml }: { readonly xml?: string }) {
  const diagnostics = validateUICXml(spacesOverviewPageHeaderUICProof, xml).diagnostics;

  return (
    <section aria-label="UIC pageHeader proof">
      <DefaultPageHeader model={{}} actions={{}} />
      {diagnostics.length > 0 && (
        <p className="myne-status myne-status--warning">
          {diagnostics.map((item) => item.code).join(", ")}
        </p>
      )}
    </section>
  );
}

type UICReadOnlyListItem = {
  readonly id: string;
  readonly label: string;
  readonly meta: readonly string[];
};

type UICSpacesOverviewActionId = "spaces.navigateToCraft";
export type UICSpacesOverviewActionDescriptor = {
  readonly event: "activate";
  readonly id: UICSpacesOverviewActionId;
  readonly args: Readonly<{ spaceId: string; tabGroupId: string }>;
  readonly status: "available" | "unavailable";
};

type UICReadOnlyListResource =
  | { readonly state: "pending" }
  | { readonly state: "empty" }
  | { readonly state: "ready"; readonly items: readonly UICReadOnlyListItem[]; readonly diagnostics: readonly string[] };

type UICSpacesResource =
  | { readonly state: "empty" }
  | { readonly state: "ready"; readonly groups: readonly { readonly id: string; readonly label: string; readonly items: readonly UICReadOnlyListItem[] }[]; readonly diagnostics: readonly string[] };

type UICWorkspaceListResource =
  | { readonly state: "pending" }
  | { readonly state: "empty" }
  | { readonly state: "error"; readonly message: string }
  | { readonly state: "ready"; readonly items: readonly UICReadOnlyListItem[]; readonly diagnostics: readonly string[] };

export const UIC_RUNNING_DEV_SERVERS_RESOURCE_BUDGET = Object.freeze({
  maxRows: 5,
  maxRepoLabelsPerRow: 2,
  maxLabelLength: 48,
  maxBranchLength: 64,
  maxRepoLabelLength: 32,
});

export const UIC_RECENTLY_VISITED_CRAFT_RESOURCE_BUDGET = Object.freeze({
  maxRows: 5,
  maxLabelLength: 48,
  maxSpaceLabelLength: 32,
});

export const UIC_RECENT_SESSIONS_RESOURCE_BUDGET = Object.freeze({
  maxRows: 5,
  maxNameLength: 56,
  maxLocationLength: 80,
});

export const UIC_RECENTLY_CREATED_CRAFT_RESOURCE_BUDGET = UIC_RECENTLY_VISITED_CRAFT_RESOURCE_BUDGET;
export const UIC_STARRED_CRAFT_RESOURCE_BUDGET = UIC_RECENTLY_VISITED_CRAFT_RESOURCE_BUDGET;
export const UIC_SPACES_RESOURCE_BUDGET = Object.freeze({
  maxSpaces: 4,
  maxCraftPerSpace: 3,
  maxSpaceLabelLength: 32,
  maxCraftLabelLength: 48,
});

export const UIC_WORKSPACE_LIST_RESOURCE_BUDGET = Object.freeze({
  maxRows: 8,
  maxRepoLabelsPerRow: 2,
  maxNameLength: 56,
  maxBranchLength: 64,
  maxRepoLabelLength: 32,
  maxErrorLength: 96,
});

export const UIC_SPACES_OVERVIEW_ACTIONS = Object.freeze({
  "spaces.navigateToCraft": Object.freeze({
    event: "activate",
    args: Object.freeze({ spaceId: "string", tabGroupId: "string" }),
    result: Object.freeze({ state: "completed" }),
  }),
});

type UICNavigateActions = Pick<SpacesOverviewSlotProps<"starredCraft">["actions"], "navigateToTabGroup">;

export function invokeUICSpacesOverviewAction(
  actions: UICNavigateActions,
  descriptor: { readonly id: string; readonly event: string; readonly status: string; readonly args: unknown },
  allowedTargets: ReadonlySet<string>,
): { readonly ok: true; readonly result: { readonly state: "completed" } } | { readonly ok: false; readonly diagnostic: { readonly code: string; readonly message: string } } {
  if (descriptor.id !== "spaces.navigateToCraft" || descriptor.event !== "activate") {
    return { ok: false, diagnostic: { code: "uic/action/unknown", message: "UIC action is not declared for this surface." } };
  }
  const args = descriptor.args;
  if (!args || typeof args !== "object" || typeof (args as { spaceId?: unknown }).spaceId !== "string" || typeof (args as { tabGroupId?: unknown }).tabGroupId !== "string") {
    return { ok: false, diagnostic: { code: "uic/action/invalid-args", message: "UIC action arguments do not match the declared schema." } };
  }
  const { spaceId, tabGroupId } = args as { spaceId: string; tabGroupId: string };
  if (descriptor.status !== "available" || !allowedTargets.has(`${spaceId}:${tabGroupId}`)) {
    return { ok: false, diagnostic: { code: "uic/action/unavailable", message: "UIC action is unavailable for the current trusted state." } };
  }
  actions.navigateToTabGroup(spaceId, tabGroupId);
  return { ok: true, result: { state: "completed" } };
}

function capUICResourceString(value: string, max: number, diagnostics: string[]): string {
  if (value.length <= max) return value;
  diagnostics.push("uic/resource/string-truncated");
  return `${value.slice(0, max)}…`;
}

function projectUICRunningDevServersResource(model: SpacesOverviewSlotProps<"runningDevServers">["model"]): UICReadOnlyListResource {
  if (model.loading) return { state: "pending" };
  const diagnostics: string[] = [];
  const seen = new Set<string>();
  const items = model.workspaces
    .filter((workspace) => workspace.has_running_dev_server)
    .filter((workspace) => {
      if (!seen.has(workspace.id)) {
        seen.add(workspace.id);
        return true;
      }
      diagnostics.push("uic/resource/duplicate-row-id");
      return false;
    })
    .slice(0, UIC_RUNNING_DEV_SERVERS_RESOURCE_BUDGET.maxRows)
    .map((workspace) => ({
      id: workspace.id,
      label: capUICResourceString(workspace.name, UIC_RUNNING_DEV_SERVERS_RESOURCE_BUDGET.maxLabelLength, diagnostics),
      meta: [
        capUICResourceString(workspace.branch, UIC_RUNNING_DEV_SERVERS_RESOURCE_BUDGET.maxBranchLength, diagnostics),
        ...workspace.repos
        .slice(0, UIC_RUNNING_DEV_SERVERS_RESOURCE_BUDGET.maxRepoLabelsPerRow)
        .map((repo) => capUICResourceString(repo.display_name || repo.name, UIC_RUNNING_DEV_SERVERS_RESOURCE_BUDGET.maxRepoLabelLength, diagnostics)),
      ],
    }));
  if (model.workspaces.filter((workspace) => workspace.has_running_dev_server).length > UIC_RUNNING_DEV_SERVERS_RESOURCE_BUDGET.maxRows) diagnostics.push("uic/resource/rows-truncated");
  if (model.workspaces.some((workspace) => workspace.has_running_dev_server && workspace.repos.length > UIC_RUNNING_DEV_SERVERS_RESOURCE_BUDGET.maxRepoLabelsPerRow)) diagnostics.push("uic/resource/repo-labels-truncated");
  return items.length ? { state: "ready", items, diagnostics: [...new Set(diagnostics)] } : { state: "empty" };
}

function UICReadOnlyListSection({
  slot,
  title,
  subtitle,
  pendingLabel,
  emptyLabel,
  countNoun,
  countNounPlural = `${countNoun}s`,
  resource,
  actionsByItemId,
  trustedActions,
}: {
  readonly slot: string;
  readonly title: string;
  readonly subtitle: string;
  readonly pendingLabel?: string;
  readonly emptyLabel: string;
  readonly countNoun: string;
  readonly countNounPlural?: string;
  readonly resource: UICReadOnlyListResource;
  readonly actionsByItemId?: ReadonlyMap<string, UICSpacesOverviewActionDescriptor>;
  readonly trustedActions?: UICNavigateActions;
}) {
  const allowedTargets = new Set(Array.from(actionsByItemId?.values() ?? []).map((action) => `${action.args.spaceId}:${action.args.tabGroupId}`));
  return (
    <section className="mb-8 rounded-xl border p-4" data-myne-slot={slot} data-uic-owned-region={slot} aria-busy={resource.state === "pending"}>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <MyneHeading className="text-lg font-semibold" level={2}>
            {title}
          </MyneHeading>
          <MyneText as="p" className="mt-1 text-xs" tone="muted">
            {subtitle}
          </MyneText>
        </div>
        {resource.state === "ready" && (
          <MyneText className="text-xs" tone="muted">
            {resource.items.length} {resource.items.length === 1 ? countNoun : countNounPlural}
          </MyneText>
        )}
      </div>
      {resource.state === "pending" ? (
        <MyneText as="p" className="myne-state myne-state--loading py-6 text-sm" tone="muted">
          {pendingLabel}
        </MyneText>
      ) : resource.state === "empty" ? (
        <MyneText as="p" className="myne-state myne-state--empty py-6 text-sm" tone="muted">
          {emptyLabel}
        </MyneText>
      ) : (
        <ul className="space-y-1">
          {resource.diagnostics.length > 0 && (
            <li className="myne-status myne-status--warning text-xs">
              {resource.diagnostics.join(", ")}
            </li>
          )}
          {resource.items.map((item) => (
            <li key={item.id} className="myne-row rounded-lg border px-4 py-3">
              <MyneText as="span" className="block text-sm font-medium" tone="primary">
                {item.label}
              </MyneText>
              {item.meta.length > 0 && (
                <MyneText as="span" className="mt-1 block text-xs" tone="muted">
                  {item.meta.join(" · ")}
                </MyneText>
              )}
              {trustedActions && actionsByItemId?.has(item.id) && (
                <button
                  type="button"
                  className="myne-button myne-button--quiet mt-2 text-xs"
                  onClick={() => {
                    const action = actionsByItemId.get(item.id);
                    if (action) invokeUICSpacesOverviewAction(trustedActions, action, allowedTargets);
                  }}
                >
                  Open craft
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function UICReadOnlyRunningDevServersSection({ model }: SpacesOverviewSlotProps<"runningDevServers">) {
  return (
    <UICReadOnlyListSection
      slot="running-dev-servers"
      title="Running Dev Servers"
      subtitle="Read-only UIC resource"
      pendingLabel="Loading running development servers"
      emptyLabel="No running development servers"
      countNoun="workspace"
      resource={projectUICRunningDevServersResource(model)}
    />
  );
}

export function projectUICRecentSessionsResource(model: Pick<SpacesOverviewSlotProps<"recentSessions">["model"], "workspace" | "currentSessionId" | "expandedSessionId" | "editingSessionId" | "sortedSessions">): UICReadOnlyListResource {
  const diagnostics: string[] = [];
  const seen = new Set<string>();
  const sessions = model.sortedSessions.filter((session) => {
    if (!seen.has(session.id)) {
      seen.add(session.id);
      return true;
    }
    diagnostics.push("uic/resource/duplicate-row-id");
    return false;
  });
  const items = sessions
    .slice(0, UIC_RECENT_SESSIONS_RESOURCE_BUDGET.maxRows)
    .map((session) => {
      const space = model.workspace.spaces.find((item) => item.id === session.activeSpaceId);
      const tabGroup = model.workspace.tabGroups.find((item) => item.id === session.activeTabGroupId);
      const sessionName = session.name?.trim() || tabGroup?.label || session.slug || "Saved voyage";
      const sessionLocation = space && tabGroup
        ? `${space.name} / ${tabGroup.label}`
        : "Recoverable voyage — saved craft is no longer available";
      return {
        id: session.id,
        label: capUICResourceString(sessionName, UIC_RECENT_SESSIONS_RESOURCE_BUDGET.maxNameLength, diagnostics),
        meta: [
          capUICResourceString(sessionLocation, UIC_RECENT_SESSIONS_RESOURCE_BUDGET.maxLocationLength, diagnostics),
          formatRelativeTime(session.updatedAt),
          ...(session.id === model.currentSessionId ? ["Current"] : []),
          ...(session.id === model.expandedSessionId ? ["Expanded"] : []),
          ...(session.id === model.editingSessionId ? ["Editing"] : []),
        ],
      };
    });
  if (sessions.length > UIC_RECENT_SESSIONS_RESOURCE_BUDGET.maxRows) diagnostics.push("uic/resource/rows-truncated");
  return items.length ? { state: "ready", items, diagnostics: [...new Set(diagnostics)] } : { state: "empty" };
}

function UICReadOnlyRecentSessionsSection({ model }: SpacesOverviewSlotProps<"recentSessions">) {
  return (
    <UICReadOnlyListSection
      slot="recent-sessions"
      title="All Voyages"
      subtitle="Read-only UIC voyage list"
      emptyLabel="No saved voyages"
      countNoun="voyage"
      resource={projectUICRecentSessionsResource(model)}
    />
  );
}

function projectUICCraftListResource({
  items,
  tabGroupDisplayLabelById,
  getTimeLabel,
  budget,
}: {
  readonly items: readonly TabGroupWithSpace[];
  readonly tabGroupDisplayLabelById: ReadonlyMap<string, string>;
  readonly getTimeLabel: (item: TabGroupWithSpace) => string | undefined;
  readonly budget: typeof UIC_RECENTLY_VISITED_CRAFT_RESOURCE_BUDGET;
}): UICReadOnlyListResource {
  const diagnostics: string[] = [];
  const seen = new Set<string>();
  const projected = items
    .filter(({ tg }) => {
      if (!seen.has(tg.id)) {
        seen.add(tg.id);
        return true;
      }
      diagnostics.push("uic/resource/duplicate-row-id");
      return false;
    })
    .slice(0, budget.maxRows)
    .map(({ space, tg }) => {
      const timeLabel = getTimeLabel({ space, tg });
      return {
        id: tg.id,
        label: capUICResourceString(tabGroupDisplayLabelById.get(tg.id) ?? tg.label, budget.maxLabelLength, diagnostics),
        meta: [
          capUICResourceString(space.name, budget.maxSpaceLabelLength, diagnostics),
          `${tg.tabs.length} view${tg.tabs.length === 1 ? "" : "s"}`,
          ...(timeLabel ? [timeLabel] : []),
        ],
      };
    });
  if (items.length > budget.maxRows) diagnostics.push("uic/resource/rows-truncated");
  return projected.length ? { state: "ready", items: projected, diagnostics: [...new Set(diagnostics)] } : { state: "empty" };
}

export function projectUICRecentlyVisitedCraftResource(model: SpacesOverviewSlotProps<"recentlyVisitedCraft">["model"]): UICReadOnlyListResource {
  return projectUICCraftListResource({
    items: model.recentlyVisited.items,
    tabGroupDisplayLabelById: model.tabGroupDisplayLabelById,
    getTimeLabel: ({ tg }) => tg.lastVisitedAt ? formatRelativeTime(tg.lastVisitedAt) : undefined,
    budget: UIC_RECENTLY_VISITED_CRAFT_RESOURCE_BUDGET,
  });
}

export function projectUICStarredCraftResource(model: SpacesOverviewSlotProps<"starredCraft">["model"]): UICReadOnlyListResource {
  return projectUICCraftListResource({
    items: model.starredTabGroups,
    tabGroupDisplayLabelById: model.tabGroupDisplayLabelById,
    getTimeLabel: () => undefined,
    budget: UIC_STARRED_CRAFT_RESOURCE_BUDGET,
  });
}

export function projectUICStarredCraftActions(model: SpacesOverviewSlotProps<"starredCraft">["model"]): readonly UICSpacesOverviewActionDescriptor[] {
  return model.starredTabGroups.map(({ space, tg }) => ({
    event: "activate",
    id: "spaces.navigateToCraft",
    args: { spaceId: space.id, tabGroupId: tg.id },
    status: "available",
  }));
}

function UICReadOnlyStarredCraftSection({ model, actions }: SpacesOverviewSlotProps<"starredCraft">) {
  const actionDescriptors = new Map(projectUICStarredCraftActions(model).map((action) => [action.args.tabGroupId, action]));
  return (
    <UICReadOnlyListSection
      slot="starred-craft"
      title="Starred"
      subtitle="Read-only UIC list"
      emptyLabel="No starred craft"
      countNoun="craft"
      countNounPlural="craft"
      resource={projectUICStarredCraftResource(model)}
      actionsByItemId={actionDescriptors}
      trustedActions={actions}
    />
  );
}

function UICReadOnlyRecentlyVisitedCraftSection({ model }: SpacesOverviewSlotProps<"recentlyVisitedCraft">) {
  return (
    <UICReadOnlyListSection
      slot="recently-visited-craft"
      title="Recently Visited"
      subtitle="Read-only UIC list"
      emptyLabel="No recently visited craft"
      countNoun="craft"
      countNounPlural="craft"
      resource={projectUICRecentlyVisitedCraftResource(model)}
    />
  );
}

export function projectUICRecentlyCreatedCraftResource(model: SpacesOverviewSlotProps<"recentlyCreatedCraft">["model"]): UICReadOnlyListResource {
  return projectUICCraftListResource({
    items: model.recentlyCreated.items,
    tabGroupDisplayLabelById: model.tabGroupDisplayLabelById,
    getTimeLabel: ({ tg }) => tg.createdAt ? formatRelativeTime(tg.createdAt) : undefined,
    budget: UIC_RECENTLY_CREATED_CRAFT_RESOURCE_BUDGET,
  });
}

function UICReadOnlyRecentlyCreatedCraftSection({ model }: SpacesOverviewSlotProps<"recentlyCreatedCraft">) {
  return (
    <UICReadOnlyListSection
      slot="recently-created-craft"
      title="Recently Created"
      subtitle="Read-only UIC list"
      emptyLabel="No recently created craft"
      countNoun="craft"
      countNounPlural="craft"
      resource={projectUICRecentlyCreatedCraftResource(model)}
    />
  );
}

export function projectUICWorkspaceListResource(model: Pick<SpacesOverviewSlotProps<"workspaceList">["model"], "loading" | "error" | "sortedWorkspaces">): UICWorkspaceListResource {
  if (model.loading) return { state: "pending" };
  const diagnostics: string[] = [];
  if (model.error) {
    return {
      state: "error",
      message: capUICResourceString(model.error, UIC_WORKSPACE_LIST_RESOURCE_BUDGET.maxErrorLength, diagnostics),
    };
  }

  const seen = new Set<string>();
  const uniqueWorkspaces = model.sortedWorkspaces.filter((workspace) => {
    if (!seen.has(workspace.id)) {
      seen.add(workspace.id);
      return true;
    }
    diagnostics.push("uic/resource/duplicate-row-id");
    return false;
  });
  const items = uniqueWorkspaces
    .slice(0, UIC_WORKSPACE_LIST_RESOURCE_BUDGET.maxRows)
    .map((workspace) => {
      if (workspace.repos.length > UIC_WORKSPACE_LIST_RESOURCE_BUDGET.maxRepoLabelsPerRow) diagnostics.push("uic/resource/repo-labels-truncated");
      return {
        id: workspace.id,
        label: capUICResourceString(workspace.name, UIC_WORKSPACE_LIST_RESOURCE_BUDGET.maxNameLength, diagnostics),
        meta: [
          capUICResourceString(workspace.branch, UIC_WORKSPACE_LIST_RESOURCE_BUDGET.maxBranchLength, diagnostics),
          ...workspace.repos
            .slice(0, UIC_WORKSPACE_LIST_RESOURCE_BUDGET.maxRepoLabelsPerRow)
            .map((repo) => capUICResourceString(repo.display_name || repo.name, UIC_WORKSPACE_LIST_RESOURCE_BUDGET.maxRepoLabelLength, diagnostics)),
        ],
      };
    });
  if (uniqueWorkspaces.length > UIC_WORKSPACE_LIST_RESOURCE_BUDGET.maxRows) diagnostics.push("uic/resource/rows-truncated");
  return items.length ? { state: "ready", items, diagnostics: [...new Set(diagnostics)] } : { state: "empty" };
}

function UICReadOnlyWorkspaceListSection({ model }: SpacesOverviewSlotProps<"workspaceList">) {
  const resource = projectUICWorkspaceListResource(model);
  return (
    <section className="mb-10 rounded-xl border p-4" data-myne-slot="workspace-list" data-uic-owned-region="workspace-list" aria-busy={resource.state === "pending"}>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <MyneHeading className="text-lg font-semibold" level={2}>
            VK Workspaces
          </MyneHeading>
          <MyneText as="p" className="mt-1 text-xs" tone="muted">
            Read-only UIC workspace list
          </MyneText>
        </div>
        {resource.state === "ready" && (
          <MyneText className="text-xs" tone="muted">
            {resource.items.length} workspace{resource.items.length === 1 ? "" : "s"}
          </MyneText>
        )}
      </div>
      {resource.state === "pending" ? (
        <MyneText as="p" className="myne-state myne-state--loading py-6 text-sm" tone="muted">
          Loading workspaces
        </MyneText>
      ) : resource.state === "error" ? (
        <MyneText as="p" className="myne-state myne-state--error py-6 text-sm" tone="secondary">
          {resource.message}
        </MyneText>
      ) : resource.state === "empty" ? (
        <MyneText as="p" className="myne-state myne-state--empty py-6 text-sm" tone="muted">
          No active workspaces
        </MyneText>
      ) : (
        <ul className="space-y-1">
          {resource.diagnostics.length > 0 && (
            <li className="myne-status myne-status--warning text-xs">
              {resource.diagnostics.join(", ")}
            </li>
          )}
          {resource.items.map((item) => (
            <li key={item.id} className="myne-row rounded-lg border px-4 py-3">
              <MyneText as="span" className="block text-sm font-medium" tone="primary">
                {item.label}
              </MyneText>
              <MyneText as="span" className="mt-1 block text-xs" tone="muted">
                {item.meta.join(" · ")}
              </MyneText>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function projectUICSpacesResource(model: SpacesOverviewSlotProps<"spaces">["model"]): UICSpacesResource {
  if (!model.hasSpaces) return { state: "empty" };
  const diagnostics: string[] = [];
  const seenSpaces = new Set<string>();
  const seenCraft = new Set<string>();
  const groups = model.spacesWithTabGroups
    .filter(({ space }) => {
      if (!seenSpaces.has(space.id)) {
        seenSpaces.add(space.id);
        return true;
      }
      diagnostics.push("uic/resource/duplicate-space-id");
      return false;
    })
    .slice(0, UIC_SPACES_RESOURCE_BUDGET.maxSpaces)
    .map(({ space, tabGroups }) => {
      const items = tabGroups
        .filter((tg) => {
          if (!seenCraft.has(tg.id)) {
            seenCraft.add(tg.id);
            return true;
          }
          diagnostics.push("uic/resource/duplicate-craft-id");
          return false;
        })
        .slice(0, UIC_SPACES_RESOURCE_BUDGET.maxCraftPerSpace)
        .map((tg) => ({
          id: tg.id,
          label: capUICResourceString(model.tabGroupDisplayLabelById.get(tg.id) ?? tg.label, UIC_SPACES_RESOURCE_BUDGET.maxCraftLabelLength, diagnostics),
          meta: [`${tg.tabs.length} view${tg.tabs.length === 1 ? "" : "s"}`],
        }));
      if (tabGroups.length > UIC_SPACES_RESOURCE_BUDGET.maxCraftPerSpace) diagnostics.push("uic/resource/craft-truncated");
      return {
        id: space.id,
        label: capUICResourceString(space.name, UIC_SPACES_RESOURCE_BUDGET.maxSpaceLabelLength, diagnostics),
        items,
      };
    });
  if (model.spacesWithTabGroups.length > UIC_SPACES_RESOURCE_BUDGET.maxSpaces) diagnostics.push("uic/resource/spaces-truncated");
  return groups.length ? { state: "ready", groups, diagnostics: [...new Set(diagnostics)] } : { state: "empty" };
}

function UICReadOnlySpacesSection({ model }: SpacesOverviewSlotProps<"spaces">) {
  const resource = projectUICSpacesResource(model);
  return (
    <section className="mb-8 rounded-xl border p-4" data-myne-slot="spaces-list" data-uic-owned-region="spaces-list">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <MyneHeading className="text-lg font-semibold" level={2}>
            All Spaces
          </MyneHeading>
          <MyneText as="p" className="mt-1 text-xs" tone="muted">
            Read-only UIC grouped list
          </MyneText>
        </div>
        {resource.state === "ready" && (
          <MyneText className="text-xs" tone="muted">
            {resource.groups.length} space{resource.groups.length === 1 ? "" : "s"}
          </MyneText>
        )}
      </div>
      {resource.state === "empty" ? (
        <MyneText as="p" className="myne-state myne-state--empty py-6 text-sm" tone="muted">
          No spaces
        </MyneText>
      ) : (
        <div className="space-y-3">
          {resource.diagnostics.length > 0 && (
            <div className="myne-status myne-status--warning text-xs">
              {resource.diagnostics.join(", ")}
            </div>
          )}
          {resource.groups.map((group) => (
            <section key={group.id} className="myne-section rounded-lg border px-4 py-3">
              <MyneHeading className="text-sm font-semibold" level={3}>
                {group.label}
              </MyneHeading>
              <ul className="mt-2 space-y-1">
                {group.items.map((item) => (
                  <li key={item.id} className="myne-row rounded border px-3 py-2">
                    <MyneText as="span" className="block text-sm font-medium" tone="primary">
                      {item.label}
                    </MyneText>
                    {item.meta.length > 0 && (
                      <MyneText as="span" className="mt-1 block text-xs" tone="muted">
                        {item.meta.join(" · ")}
                      </MyneText>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

export function SpacesOverviewUICLayoutProofPresentation({
  xml = spacesOverviewUICLayoutXml,
  ...props
}: SpacesOverviewComponentProps & { readonly xml?: string }) {
  const diagnostics = validateUICXml(spacesOverviewPageHeaderUICProof, xml).diagnostics;
  const ui = diagnostics.length ? defaultSpacesOverviewUI : { ...defaultSpacesOverviewUI, RecentSessionsSection: UICReadOnlyRecentSessionsSection, StarredCraftSection: UICReadOnlyStarredCraftSection, RunningDevServersSection: UICReadOnlyRunningDevServersSection, RecentlyVisitedCraftSection: UICReadOnlyRecentlyVisitedCraftSection, RecentlyCreatedCraftSection: UICReadOnlyRecentlyCreatedCraftSection, WorkspaceListSection: UICReadOnlyWorkspaceListSection, SpacesSection: UICReadOnlySpacesSection };

  return (
    <>
      <DefaultSpacesOverviewLayout
        {...props}
        ui={ui}
        viewPackId={diagnostics.length ? "myne.spaces.view-pack.default" : "uic.spaces.layout-shell.proof"}
      />
      {diagnostics.length > 0 && (
        <p className="myne-status myne-status--warning">
          {diagnostics.map((item) => item.code).join(", ")}
        </p>
      )}
    </>
  );
}
