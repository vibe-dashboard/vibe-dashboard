import { DefaultPageHeader, DefaultSpacesOverviewLayout, defaultSpacesOverviewUI } from "./DefaultSpacesOverview.view";
import type { DashboardWorkspace, SpacesOverviewComponentProps, TabGroupWithSpace } from "./SpacesOverview.contracts";
import type { SpacesOverviewSlotProps } from "./SpacesOverview.slots";
import { formatRelativeTime } from "./workspaceList.view";
import { MyneHeading, MyneText } from "../../theme/skins";
import { getUICValidatedActionBindings, spacesOverviewPageHeaderUICProof, validateUICXml } from "../../uic/trustedComponents";

export const spacesOverviewUICLayoutXml = `<uic:spaceOverviewPage xmlns:uic="https://vibedashboard.dev/uic/xml/v1" artifactVersion="1">
  <uic:css><![CDATA[:uic-scope { --myne-slot-page-header-gap: 1rem; }]]></uic:css>
  <uic:pageHeader title="{model.title}" subtitle="{model.subtitle}">
    <uic:slot name="actions">
      <uic:pageHeaderAction label="Start voyage" />
    </uic:slot>
  </uic:pageHeader>
  <uic:recentSessions uic:on-resume="spaces.resumeSession" uic:on-start="spaces.startSession" uic:on-rename="spaces.renameSession" />
  <uic:starredCraft uic:on-activate="spaces.navigateToCraft" />
  <uic:runningDevServers uic:on-stop="spaces.stopDevServer" />
  <uic:recentlyVisitedCraft uic:on-activate="spaces.navigateToCraft" />
  <uic:recentlyCreatedCraft uic:on-activate="spaces.navigateToCraft" />
  <uic:workspaceList uic:on-activate="spaces.openWorkspace" uic:on-filter="spaces.filterWorkspaces" uic:on-page="spaces.pageWorkspaces" />
  <uic:spaces uic:on-activate="spaces.navigateToCraft" />
  <uic:spacePicker uic:on-close="spaces.dismissPicker" uic:on-retry="spaces.retryOpenWorkspace" uic:on-select="spaces.selectSpaceForWorkspace" />
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

type UICSpacesOverviewActionId = "spaces.navigateToCraft" | "spaces.resumeSession" | "spaces.startSession" | "spaces.renameSession" | "spaces.stopDevServer" | "spaces.openWorkspace" | "spaces.filterWorkspaces" | "spaces.pageWorkspaces" | "spaces.dismissPicker" | "spaces.retryOpenWorkspace" | "spaces.selectSpaceForWorkspace";
type UICCraftActionDescriptor = {
  readonly event: "activate";
  readonly id: "spaces.navigateToCraft";
  readonly args: Readonly<{ spaceId: string; tabGroupId: string }>;
  readonly status: "available" | "unavailable";
};
type UICRecentSessionResumeActionDescriptor = {
  readonly event: "resume";
  readonly id: "spaces.resumeSession";
  readonly args: Readonly<{ sessionId: string }>;
  readonly status: "available" | "unavailable";
};
type UICRecentSessionStartActionDescriptor = {
  readonly event: "start";
  readonly id: "spaces.startSession";
  readonly args: Readonly<Record<string, never>>;
  readonly status: "available" | "unavailable";
};
type UICRecentSessionRenameActionDescriptor = {
  readonly event: "rename";
  readonly id: "spaces.renameSession";
  readonly args: Readonly<{ sessionId: string; name: string }>;
  readonly status: "available" | "unavailable";
  readonly lifecycle: UICActionLifecycle;
};
type UICWorkspaceActionDescriptor = {
  readonly event: "activate";
  readonly id: "spaces.openWorkspace";
  readonly args: Readonly<{ workspaceId: string }>;
  readonly status: "available" | "unavailable";
};
type UICRunningDevServerStopActionDescriptor = {
  readonly event: "stop";
  readonly id: "spaces.stopDevServer";
  readonly args: Readonly<{ workspaceId: string }>;
  readonly status: "available" | "unavailable";
  readonly lifecycle: UICActionLifecycle;
};
type UICWorkspaceFilterActionDescriptor = {
  readonly event: "filter";
  readonly id: "spaces.filterWorkspaces";
  readonly args: Readonly<{ repoId: string }>;
  readonly status: "available" | "unavailable";
};
type UICWorkspacePageActionDescriptor = {
  readonly event: "page";
  readonly id: "spaces.pageWorkspaces";
  readonly args: Readonly<{ direction: "previous" | "next"; page: number }>;
  readonly status: "available" | "unavailable";
};
type UICSpacePickerActionDescriptor = {
  readonly event: "close" | "retry";
  readonly id: "spaces.dismissPicker" | "spaces.retryOpenWorkspace";
  readonly args: Readonly<Record<string, never>>;
  readonly status: "available" | "unavailable";
};
type UICSpacePickerSelectActionDescriptor = {
  readonly event: "select";
  readonly id: "spaces.selectSpaceForWorkspace";
  readonly args: Readonly<{ spaceId: string }>;
  readonly status: "available" | "unavailable";
};
export type UICSpacesOverviewActionDescriptor = UICCraftActionDescriptor | UICRecentSessionResumeActionDescriptor | UICRecentSessionStartActionDescriptor | UICRecentSessionRenameActionDescriptor | UICRunningDevServerStopActionDescriptor | UICWorkspaceActionDescriptor | UICWorkspaceFilterActionDescriptor | UICWorkspacePageActionDescriptor | UICSpacePickerActionDescriptor | UICSpacePickerSelectActionDescriptor;
type UICActionDiagnostic = Readonly<{ code: string; message: string; recoverable?: boolean }>;
type UICActionLifecycle = Readonly<{
  confirmation?: Readonly<{ required: boolean; title?: string; message?: string; confirmLabel?: string; tone?: "neutral" | "warning" | "destructive" }>;
  pending?: Readonly<{ key: string; label: string }>;
  result: Readonly<{ state: "idle" | "pending" | "completed" } | { state: "failed"; diagnostic: UICActionDiagnostic }>;
  diagnostics: readonly string[];
  authorization: Readonly<{ state: "allowed" } | { state: "denied"; reason: string }>;
}>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isSafeLifecycleText(value: unknown, maxLength = 120) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || /[<>]|https?:|javascript:/iu.test(value)) return false;
  const lower = value.toLowerCase();
  return !["function", "promise", `app${"hooks"}`, "queryclient"].some((word) => lower.includes(word));
}

function validateUICActionLifecycle(input: unknown): { readonly ok: true; readonly lifecycle: UICActionLifecycle } | { readonly ok: false; readonly diagnostic: UICActionDiagnostic } {
  if (!isPlainRecord(input) || !hasExactKeys(input, ["confirmation", "pending", "result", "diagnostics", "authorization"]) || !isPlainRecord(input.result) || !Array.isArray(input.diagnostics) || !isPlainRecord(input.authorization)) {
    return { ok: false, diagnostic: { code: "uic/action/invalid-lifecycle", message: "UIC action lifecycle metadata is malformed.", recoverable: false } };
  }
  const result = input.result;
  const resultState = result.state;
  if (resultState !== "idle" && resultState !== "pending" && resultState !== "completed" && resultState !== "failed") {
    return { ok: false, diagnostic: { code: "uic/action/invalid-lifecycle", message: "UIC action result state is invalid.", recoverable: false } };
  }
  let resultEnvelope: UICActionLifecycle["result"];
  if (resultState === "failed") {
    const diagnostic = result.diagnostic;
    if (!hasExactKeys(result, ["state", "diagnostic"]) || !isPlainRecord(diagnostic) || !hasExactKeys(diagnostic, ["code", "message", "recoverable"]) || !isSafeLifecycleText(diagnostic.code, 80) || !isSafeLifecycleText(diagnostic.message, 160) || typeof diagnostic.recoverable !== "boolean") {
      return { ok: false, diagnostic: { code: "uic/action/invalid-lifecycle", message: "UIC action failure envelope is invalid.", recoverable: false } };
    }
    resultEnvelope = { state: "failed", diagnostic: { code: diagnostic.code as string, message: diagnostic.message as string, recoverable: diagnostic.recoverable } };
  } else {
    if (!hasExactKeys(result, ["state"])) {
      return { ok: false, diagnostic: { code: "uic/action/invalid-lifecycle", message: "UIC action result state is invalid.", recoverable: false } };
    }
    resultEnvelope = { state: resultState };
  }
  if (!input.diagnostics.every((item) => isSafeLifecycleText(item, 80))) {
    return { ok: false, diagnostic: { code: "uic/action/invalid-lifecycle", message: "UIC action diagnostics are invalid.", recoverable: false } };
  }
  const authorization = input.authorization;
  if (authorization.state !== "allowed" && authorization.state !== "denied") {
    return { ok: false, diagnostic: { code: "uic/action/invalid-lifecycle", message: "UIC action authorization state is invalid.", recoverable: false } };
  }
  if (authorization.state === "allowed" && !hasExactKeys(authorization, ["state"])) {
    return { ok: false, diagnostic: { code: "uic/action/invalid-lifecycle", message: "UIC action authorization state is invalid.", recoverable: false } };
  }
  if (authorization.state === "denied" && (!hasExactKeys(authorization, ["state", "reason"]) || !isSafeLifecycleText(authorization.reason, 120))) {
    return { ok: false, diagnostic: { code: "uic/action/invalid-lifecycle", message: "UIC action authorization reason is invalid.", recoverable: false } };
  }
  const lifecycle: UICActionLifecycle = {
    result: resultEnvelope,
    diagnostics: [...input.diagnostics],
    authorization: authorization.state === "allowed" ? { state: "allowed" } : { state: "denied", reason: authorization.reason as string },
  };
  if (input.pending !== undefined) {
    if (!isPlainRecord(input.pending) || !hasExactKeys(input.pending, ["key", "label"]) || !isSafeLifecycleText(input.pending.key, 120) || !isSafeLifecycleText(input.pending.label, 80)) {
      return { ok: false, diagnostic: { code: "uic/action/invalid-lifecycle", message: "UIC action pending identity is invalid.", recoverable: false } };
    }
    (lifecycle as { pending?: UICActionLifecycle["pending"] }).pending = { key: input.pending.key as string, label: input.pending.label as string };
  }
  if (input.confirmation !== undefined) {
    if (!isPlainRecord(input.confirmation) || !hasExactKeys(input.confirmation, ["required", "title", "message", "confirmLabel", "tone"]) || typeof input.confirmation.required !== "boolean") {
      return { ok: false, diagnostic: { code: "uic/action/invalid-lifecycle", message: "UIC action confirmation metadata is invalid.", recoverable: false } };
    }
    for (const key of ["title", "message", "confirmLabel"] as const) {
      if (input.confirmation[key] !== undefined && !isSafeLifecycleText(input.confirmation[key], key === "message" ? 160 : 80)) {
        return { ok: false, diagnostic: { code: "uic/action/invalid-lifecycle", message: "UIC action confirmation text is invalid.", recoverable: false } };
      }
    }
    if (input.confirmation.tone !== undefined && input.confirmation.tone !== "neutral" && input.confirmation.tone !== "warning" && input.confirmation.tone !== "destructive") {
      return { ok: false, diagnostic: { code: "uic/action/invalid-lifecycle", message: "UIC action confirmation tone is invalid.", recoverable: false } };
    }
    (lifecycle as { confirmation?: UICActionLifecycle["confirmation"] }).confirmation = {
      required: input.confirmation.required,
      ...(input.confirmation.title !== undefined ? { title: input.confirmation.title as string } : {}),
      ...(input.confirmation.message !== undefined ? { message: input.confirmation.message as string } : {}),
      ...(input.confirmation.confirmLabel !== undefined ? { confirmLabel: input.confirmation.confirmLabel as string } : {}),
      ...(input.confirmation.tone !== undefined ? { tone: input.confirmation.tone } : {}),
    };
  }
  return { ok: true, lifecycle };
}

export function resolveUICActionLifecycle<T extends UICSpacesOverviewActionDescriptor>(
  descriptor: T,
  lifecycleInput: unknown,
  context: Readonly<{ authorized: boolean; confirmed?: boolean; pendingKeys?: ReadonlySet<string> }>,
): { readonly ok: true; readonly descriptor: T & { readonly lifecycle: UICActionLifecycle } } | { readonly ok: false; readonly diagnostic: UICActionDiagnostic } {
  const validated = validateUICActionLifecycle(lifecycleInput);
  if (!validated.ok) return validated;
  const { lifecycle } = validated;
  if (descriptor.status !== "available") return { ok: false, diagnostic: { code: "uic/action/unavailable", message: "UIC action is unavailable for the current trusted state.", recoverable: true } };
  if (!context.authorized || lifecycle.authorization.state !== "allowed") return { ok: false, diagnostic: { code: "uic/action/unauthorized", message: "UIC action is not authorized for the current trusted state.", recoverable: false } };
  if (lifecycle.pending && context.pendingKeys?.has(lifecycle.pending.key)) return { ok: false, diagnostic: { code: "uic/action/pending", message: "UIC action is already pending.", recoverable: true } };
  if (lifecycle.confirmation?.required && !context.confirmed) return { ok: false, diagnostic: { code: "uic/action/confirmation-required", message: "UIC action requires explicit confirmation.", recoverable: true } };
  if (lifecycle.result.state === "pending") return { ok: false, diagnostic: { code: "uic/action/pending", message: "UIC action is pending.", recoverable: true } };
  if (lifecycle.result.state === "failed") return { ok: false, diagnostic: lifecycle.result.diagnostic };
  return { ok: true, descriptor: { ...descriptor, lifecycle } };
}

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
  maxFilterRepos: 8,
  maxRepoLabelsPerRow: 2,
  maxNameLength: 56,
  maxBranchLength: 64,
  maxRepoLabelLength: 32,
  maxErrorLength: 96,
});

export const UIC_SPACE_PICKER_RESOURCE_BUDGET = Object.freeze({
  maxSpaces: 8,
  maxSpaceLabelLength: 48,
});

export const UIC_SPACES_OVERVIEW_ACTIONS = Object.freeze({
  "spaces.navigateToCraft": Object.freeze({
    event: "activate",
    args: Object.freeze({ spaceId: "string", tabGroupId: "string" }),
    result: Object.freeze({ state: "completed" }),
  }),
  "spaces.resumeSession": Object.freeze({
    event: "resume",
    args: Object.freeze({ sessionId: "string" }),
    result: Object.freeze({ state: "completed" }),
  }),
  "spaces.startSession": Object.freeze({
    event: "start",
    args: Object.freeze({}),
    result: Object.freeze({ state: "completed" }),
  }),
  "spaces.renameSession": Object.freeze({
    event: "rename",
    args: Object.freeze({ sessionId: "string", name: "string" }),
    result: Object.freeze({ state: "completed|failed" }),
    lifecycle: Object.freeze({ confirmation: "optional", pending: "sessionId", authorization: "trusted-host" }),
  }),
  "spaces.openWorkspace": Object.freeze({
    event: "activate",
    args: Object.freeze({ workspaceId: "string" }),
    result: Object.freeze({ state: "completed" }),
  }),
  "spaces.stopDevServer": Object.freeze({
    event: "stop",
    args: Object.freeze({ workspaceId: "string" }),
    result: Object.freeze({ state: "completed|failed" }),
    lifecycle: Object.freeze({ confirmation: "required", pending: "workspaceId", authorization: "trusted-host" }),
  }),
  "spaces.filterWorkspaces": Object.freeze({
    event: "filter",
    args: Object.freeze({ repoId: "string" }),
    result: Object.freeze({ state: "completed" }),
  }),
  "spaces.pageWorkspaces": Object.freeze({
    event: "page",
    args: Object.freeze({ direction: "previous|next", page: "number" }),
    result: Object.freeze({ state: "completed" }),
  }),
  "spaces.dismissPicker": Object.freeze({
    event: "close",
    args: Object.freeze({}),
    result: Object.freeze({ state: "completed" }),
  }),
  "spaces.retryOpenWorkspace": Object.freeze({
    event: "retry",
    args: Object.freeze({}),
    result: Object.freeze({ state: "completed" }),
  }),
  "spaces.selectSpaceForWorkspace": Object.freeze({
    event: "select",
    args: Object.freeze({ spaceId: "string" }),
    result: Object.freeze({ state: "completed" }),
  }),
});

type UICNavigateActions = Pick<SpacesOverviewSlotProps<"starredCraft">["actions"], "navigateToTabGroup">;
type UICRecentSessionActions = Pick<SpacesOverviewSlotProps<"recentSessions">["actions"], "resumeSession" | "startNewSession" | "renameSession">;
type UICRunningDevServerActions = Pick<SpacesOverviewSlotProps<"runningDevServers">["actions"], "stopDevServer">;
type UICWorkspaceListActions = Pick<SpacesOverviewSlotProps<"workspaceList">["actions"], "openSpacePickerForWorkspace" | "selectRepo" | "setWorkspacePage">;
type UICSpacePickerActions = Pick<SpacesOverviewSlotProps<"spacePicker">["actions"], "closeSpacePicker" | "retryOpenCraftRequest" | "runOpenCraftRequest">;

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

export function invokeUICRecentSessionAction(
  actions: UICRecentSessionActions,
  descriptor: { readonly id: string; readonly event: string; readonly status: string; readonly args: unknown },
  allowedSessionIds: ReadonlySet<string>,
  allowStart: boolean,
): { readonly ok: true; readonly result: { readonly state: "completed" } } | { readonly ok: false; readonly diagnostic: { readonly code: string; readonly message: string } } {
  if (
    !(
      (descriptor.id === "spaces.resumeSession" && descriptor.event === "resume") ||
      (descriptor.id === "spaces.startSession" && descriptor.event === "start") ||
      (descriptor.id === "spaces.renameSession" && descriptor.event === "rename")
    )
  ) {
    return { ok: false, diagnostic: { code: "uic/action/unknown", message: "UIC action is not declared for this surface." } };
  }
  if (descriptor.status !== "available") {
    return { ok: false, diagnostic: { code: "uic/action/unavailable", message: "UIC action is unavailable for the current trusted state." } };
  }
  if (descriptor.id === "spaces.startSession") {
    if (!descriptor.args || typeof descriptor.args !== "object" || Object.keys(descriptor.args).length > 0) {
      return { ok: false, diagnostic: { code: "uic/action/invalid-args", message: "UIC action arguments do not match the declared schema." } };
    }
    if (!allowStart) return { ok: false, diagnostic: { code: "uic/action/unavailable", message: "UIC action is unavailable for the current trusted state." } };
    actions.startNewSession();
    return { ok: true, result: { state: "completed" } };
  }
  if (descriptor.id === "spaces.renameSession") {
    const args = descriptor.args;
    if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).length !== 2 || typeof (args as { sessionId?: unknown }).sessionId !== "string" || typeof (args as { name?: unknown }).name !== "string") {
      return { ok: false, diagnostic: { code: "uic/action/invalid-args", message: "UIC action arguments do not match the declared schema." } };
    }
    const { sessionId, name } = args as { sessionId: string; name: string };
    if (!name.trim() || !allowedSessionIds.has(sessionId)) {
      return { ok: false, diagnostic: { code: "uic/action/unavailable", message: "UIC action is unavailable for the current trusted state." } };
    }
    const lifecycle = resolveUICActionLifecycle(descriptor as UICRecentSessionRenameActionDescriptor, (descriptor as { readonly lifecycle?: unknown }).lifecycle, { authorized: true, confirmed: true });
    if (!lifecycle.ok) return lifecycle;
    actions.renameSession(sessionId, name.trim());
    return { ok: true, result: { state: "completed" } };
  }
  const args = descriptor.args;
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).length !== 1 || typeof (args as { sessionId?: unknown }).sessionId !== "string") {
    return { ok: false, diagnostic: { code: "uic/action/invalid-args", message: "UIC action arguments do not match the declared schema." } };
  }
  const sessionId = (args as { sessionId: string }).sessionId;
  if (!allowedSessionIds.has(sessionId)) {
    return { ok: false, diagnostic: { code: "uic/action/unavailable", message: "UIC action is unavailable for the current trusted state." } };
  }
  actions.resumeSession(sessionId);
  return { ok: true, result: { state: "completed" } };
}

export function invokeUICRunningDevServerAction(
  actions: UICRunningDevServerActions,
  descriptor: { readonly id: string; readonly event: string; readonly status: string; readonly args: unknown; readonly lifecycle?: unknown },
  allowedWorkspaces: ReadonlySet<string>,
  pendingKeys: ReadonlySet<string>,
  context: Readonly<{ authorized: boolean; confirmed?: boolean }>,
): { readonly ok: true; readonly result: { readonly state: "completed" } } | { readonly ok: false; readonly diagnostic: { readonly code: string; readonly message: string } } {
  if (descriptor.id !== "spaces.stopDevServer" || descriptor.event !== "stop") {
    return { ok: false, diagnostic: { code: "uic/action/unknown", message: "UIC action is not declared for this surface." } };
  }
  const args = descriptor.args;
  if (!args || typeof args !== "object" || typeof (args as { workspaceId?: unknown }).workspaceId !== "string") {
    return { ok: false, diagnostic: { code: "uic/action/invalid-args", message: "UIC action arguments do not match the declared schema." } };
  }
  const workspaceId = (args as { workspaceId: string }).workspaceId;
  if (!allowedWorkspaces.has(workspaceId)) {
    return { ok: false, diagnostic: { code: "uic/action/unavailable", message: "UIC action is unavailable for the current trusted state." } };
  }
  const lifecycle = resolveUICActionLifecycle(descriptor as UICRunningDevServerStopActionDescriptor, descriptor.lifecycle, { ...context, pendingKeys });
  if (!lifecycle.ok) return lifecycle;
  actions.stopDevServer(workspaceId);
  return { ok: true, result: { state: "completed" } };
}

export function invokeUICWorkspaceListAction(
  actions: UICWorkspaceListActions,
  descriptor: { readonly id: string; readonly event: string; readonly status: string; readonly args: unknown },
  allowedWorkspaces: ReadonlyMap<string, DashboardWorkspace>,
  allowedFilters: ReadonlySet<string> = new Set(),
  allowedPages: ReadonlyMap<string, number> = new Map(),
): { readonly ok: true; readonly result: { readonly state: "completed" } } | { readonly ok: false; readonly diagnostic: { readonly code: string; readonly message: string } } {
  if (
    !(
      (descriptor.id === "spaces.openWorkspace" && descriptor.event === "activate") ||
      (descriptor.id === "spaces.filterWorkspaces" && descriptor.event === "filter") ||
      (descriptor.id === "spaces.pageWorkspaces" && descriptor.event === "page")
    )
  ) {
    return { ok: false, diagnostic: { code: "uic/action/unknown", message: "UIC action is not declared for this surface." } };
  }
  const args = descriptor.args;
  if (descriptor.status !== "available") {
    return { ok: false, diagnostic: { code: "uic/action/unavailable", message: "UIC action is unavailable for the current trusted state." } };
  }
  if (descriptor.id === "spaces.filterWorkspaces") {
    if (!args || typeof args !== "object" || typeof (args as { repoId?: unknown }).repoId !== "string") {
      return { ok: false, diagnostic: { code: "uic/action/invalid-args", message: "UIC action arguments do not match the declared schema." } };
    }
    const repoId = (args as { repoId: string }).repoId;
    if (!allowedFilters.has(repoId)) {
      return { ok: false, diagnostic: { code: "uic/action/unavailable", message: "UIC action is unavailable for the current trusted state." } };
    }
    actions.selectRepo(repoId === "__all__" ? null : repoId);
    return { ok: true, result: { state: "completed" } };
  }
  if (descriptor.id === "spaces.pageWorkspaces") {
    if (!args || typeof args !== "object" || ((args as { direction?: unknown }).direction !== "previous" && (args as { direction?: unknown }).direction !== "next") || typeof (args as { page?: unknown }).page !== "number") {
      return { ok: false, diagnostic: { code: "uic/action/invalid-args", message: "UIC action arguments do not match the declared schema." } };
    }
    const { direction, page } = args as { direction: "previous" | "next"; page: number };
    if (allowedPages.get(direction) !== page) {
      return { ok: false, diagnostic: { code: "uic/action/unavailable", message: "UIC action is unavailable for the current trusted state." } };
    }
    actions.setWorkspacePage(page);
    return { ok: true, result: { state: "completed" } };
  }
  if (!args || typeof args !== "object" || typeof (args as { workspaceId?: unknown }).workspaceId !== "string") {
    return { ok: false, diagnostic: { code: "uic/action/invalid-args", message: "UIC action arguments do not match the declared schema." } };
  }
  const workspace = allowedWorkspaces.get((args as { workspaceId: string }).workspaceId);
  if (!workspace) {
    return { ok: false, diagnostic: { code: "uic/action/unavailable", message: "UIC action is unavailable for the current trusted state." } };
  }
  actions.openSpacePickerForWorkspace(workspace);
  return { ok: true, result: { state: "completed" } };
}

export function invokeUICSpacePickerAction(
  actions: UICSpacePickerActions,
  descriptor: { readonly id: string; readonly event: string; readonly status: string; readonly args: unknown },
  allowedActions: ReadonlySet<string>,
  allowedSpaceRequests: ReadonlyMap<string, { readonly workspace: DashboardWorkspace; readonly spaceId: string }> = new Map(),
): { readonly ok: true; readonly result: { readonly state: "completed" } } | { readonly ok: false; readonly diagnostic: { readonly code: string; readonly message: string } } {
  if (
    !(
      (descriptor.id === "spaces.dismissPicker" && descriptor.event === "close") ||
      (descriptor.id === "spaces.retryOpenWorkspace" && descriptor.event === "retry") ||
      (descriptor.id === "spaces.selectSpaceForWorkspace" && descriptor.event === "select")
    )
  ) {
    return { ok: false, diagnostic: { code: "uic/action/unknown", message: "UIC action is not declared for this surface." } };
  }
  if (descriptor.status !== "available" || !allowedActions.has(descriptor.id)) {
    return { ok: false, diagnostic: { code: "uic/action/unavailable", message: "UIC action is unavailable for the current trusted state." } };
  }
  if (descriptor.id === "spaces.selectSpaceForWorkspace") {
    if (!descriptor.args || typeof descriptor.args !== "object" || typeof (descriptor.args as { spaceId?: unknown }).spaceId !== "string") {
      return { ok: false, diagnostic: { code: "uic/action/invalid-args", message: "UIC action arguments do not match the declared schema." } };
    }
    const request = allowedSpaceRequests.get((descriptor.args as { spaceId: string }).spaceId);
    if (!request) {
      return { ok: false, diagnostic: { code: "uic/action/unavailable", message: "UIC action is unavailable for the current trusted state." } };
    }
    actions.runOpenCraftRequest(request);
    return { ok: true, result: { state: "completed" } };
  }
  if (!descriptor.args || typeof descriptor.args !== "object" || Object.keys(descriptor.args).length > 0) {
    return { ok: false, diagnostic: { code: "uic/action/invalid-args", message: "UIC action arguments do not match the declared schema." } };
  }
  if (descriptor.id === "spaces.dismissPicker") actions.closeSpacePicker();
  else actions.retryOpenCraftRequest();
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

function projectUICRunningDevServerTargets(model: Pick<SpacesOverviewSlotProps<"runningDevServers">["model"], "workspaces" | "stoppingDevServerIds">): readonly DashboardWorkspace[] {
  const seen = new Set<string>();
  return model.workspaces
    .filter((workspace) => workspace.has_running_dev_server && !model.stoppingDevServerIds.has(workspace.id))
    .filter((workspace) => {
      if (seen.has(workspace.id)) return false;
      seen.add(workspace.id);
      return true;
    })
    .slice(0, UIC_RUNNING_DEV_SERVERS_RESOURCE_BUDGET.maxRows);
}

export function projectUICRunningDevServerActions(model: Pick<SpacesOverviewSlotProps<"runningDevServers">["model"], "workspaces" | "stoppingDevServerIds">, enabled = true): readonly UICRunningDevServerStopActionDescriptor[] {
  if (!enabled) return [];
  return projectUICRunningDevServerTargets(model).map((workspace) => ({
    event: "stop",
    id: "spaces.stopDevServer",
    args: { workspaceId: workspace.id },
    status: "available",
    lifecycle: {
      confirmation: {
        required: true,
        title: "Stop development server?",
        message: "Stop this running development server.",
        confirmLabel: "Stop server",
        tone: "destructive",
      },
      pending: { key: `running-dev-server:${workspace.id}:stop`, label: "Stopping development server" },
      result: { state: "idle" },
      diagnostics: [],
      authorization: { state: "allowed" },
    },
  }));
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
  readonly actionsByItemId?: ReadonlyMap<string, UICCraftActionDescriptor>;
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

export function UICReadOnlyRunningDevServersSection({ model, actions, enableStopAction = true }: SpacesOverviewSlotProps<"runningDevServers"> & { readonly enableStopAction?: boolean }) {
  const resource = projectUICRunningDevServersResource(model);
  const actionDescriptors = new Map(projectUICRunningDevServerActions(model, enableStopAction).map((action) => [action.args.workspaceId, action]));
  const allowedWorkspaces = new Set(actionDescriptors.keys());
  const pendingKeys = new Set(Array.from(model.stoppingDevServerIds).map((id) => `running-dev-server:${id}:stop`));
  return (
    <section className="mb-8 rounded-xl border p-4" data-myne-slot="running-dev-servers" data-uic-owned-region="running-dev-servers" aria-busy={resource.state === "pending"}>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <MyneHeading className="text-lg font-semibold" level={2}>
            Running Dev Servers
          </MyneHeading>
          <MyneText as="p" className="mt-1 text-xs" tone="muted">
            Read-only UIC resource
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
          Loading running development servers
        </MyneText>
      ) : resource.state === "empty" ? (
        <MyneText as="p" className="myne-state myne-state--empty py-6 text-sm" tone="muted">
          No running development servers
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
              {actionDescriptors.has(item.id) && (
                <button
                  type="button"
                  className="myne-button myne-button--danger mt-2 text-xs"
                  onClick={() => {
                    const action = actionDescriptors.get(item.id);
                    if (action) invokeUICRunningDevServerAction(actions, action, allowedWorkspaces, pendingKeys, { authorized: true, confirmed: false });
                  }}
                >
                  Stop server
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
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

function projectUICRecentSessionTargets(model: Pick<SpacesOverviewSlotProps<"recentSessions">["model"], "sortedSessions">): readonly { readonly id: string }[] {
  const seen = new Set<string>();
  return model.sortedSessions
    .filter((session) => {
      if (seen.has(session.id)) return false;
      seen.add(session.id);
      return true;
    })
    .slice(0, UIC_RECENT_SESSIONS_RESOURCE_BUDGET.maxRows);
}

export function projectUICRecentSessionActions(
  model: Pick<SpacesOverviewSlotProps<"recentSessions">["model"], "sortedSessions"> & Partial<Pick<SpacesOverviewSlotProps<"recentSessions">["model"], "editingSessionId" | "sessionNameDraft">>,
  enabled: Readonly<{ resume: boolean; start: boolean; rename?: boolean }> = { resume: true, start: true, rename: true },
): readonly (UICRecentSessionResumeActionDescriptor | UICRecentSessionStartActionDescriptor | UICRecentSessionRenameActionDescriptor)[] {
  const renameName = model.sessionNameDraft?.trim();
  const canRename = !!enabled.rename && !!model.editingSessionId && !!renameName && projectUICRecentSessionTargets(model).some((session) => session.id === model.editingSessionId);
  return [
    ...(enabled.start ? [{ event: "start" as const, id: "spaces.startSession" as const, args: {}, status: "available" as const }] : []),
    ...(enabled.resume ? projectUICRecentSessionTargets(model).map((session) => ({
      event: "resume" as const,
      id: "spaces.resumeSession" as const,
      args: { sessionId: session.id },
      status: "available" as const,
    })) : []),
    ...(canRename ? [{
      event: "rename" as const,
      id: "spaces.renameSession" as const,
      args: { sessionId: model.editingSessionId!, name: renameName! },
      status: "available" as const,
      lifecycle: {
        confirmation: { required: false },
        pending: { key: `recent-session:${model.editingSessionId}:rename`, label: "Renaming voyage" },
        result: { state: "idle" as const },
        diagnostics: [],
        authorization: { state: "allowed" as const },
      },
    }] : []),
  ];
}

function UICReadOnlyRecentSessionsSection({ model, actions, enableResumeAction = true, enableStartAction = true, enableRenameAction = true }: SpacesOverviewSlotProps<"recentSessions"> & { readonly enableResumeAction?: boolean; readonly enableStartAction?: boolean; readonly enableRenameAction?: boolean }) {
  const resource = projectUICRecentSessionsResource(model);
  const sessionActions = projectUICRecentSessionActions(model, { resume: enableResumeAction, start: enableStartAction, rename: enableRenameAction });
  const resumeActions = new Map(sessionActions.filter((action): action is UICRecentSessionResumeActionDescriptor => action.id === "spaces.resumeSession").map((action) => [action.args.sessionId, action]));
  const renameActions = new Map(sessionActions.filter((action): action is UICRecentSessionRenameActionDescriptor => action.id === "spaces.renameSession").map((action) => [action.args.sessionId, action]));
  const startAction = sessionActions.find((action): action is UICRecentSessionStartActionDescriptor => action.id === "spaces.startSession");
  const resumableSessionIds = new Set(resumeActions.keys());
  const renameableSessionIds = new Set(renameActions.keys());
  return (
    <section className="mb-8 rounded-xl border p-4" data-myne-slot="recent-sessions" data-uic-owned-region="recent-sessions" aria-busy={false}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <MyneHeading className="text-lg font-semibold" level={2}>
            All Voyages
          </MyneHeading>
          <MyneText as="p" className="mt-1 text-xs" tone="muted">
            Read-only UIC voyage list
          </MyneText>
        </div>
        {startAction && (
          <button
            type="button"
            className="myne-button rounded border px-3 py-1.5 text-xs"
            onClick={() => invokeUICRecentSessionAction(actions, startAction, resumableSessionIds, true)}
          >
            New Voyage
          </button>
        )}
      </div>
      {resource.state === "pending" ? (
        <MyneText as="p" className="myne-state myne-state--loading py-6 text-sm" tone="muted">
          Loading voyages
        </MyneText>
      ) : resource.state === "empty" ? (
        <MyneText as="p" className="myne-state myne-state--empty py-6 text-sm" tone="muted">
          No saved voyages
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
              {resumeActions.has(item.id) && (
                <button
                  type="button"
                  className="myne-button myne-button--quiet mt-2 text-xs"
                  onClick={() => {
                    const action = resumeActions.get(item.id);
                    if (action) invokeUICRecentSessionAction(actions, action, resumableSessionIds, !!startAction);
                  }}
                >
                  Resume voyage
                </button>
              )}
              {renameActions.has(item.id) && (
                <button
                  type="button"
                  className="myne-button myne-button--quiet mt-2 text-xs"
                  onClick={() => {
                    const action = renameActions.get(item.id);
                    if (action) invokeUICRecentSessionAction(actions, action, renameableSessionIds, !!startAction);
                  }}
                >
                  Save rename
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
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

export function projectUICStarredCraftActions(model: SpacesOverviewSlotProps<"starredCraft">["model"], enabled = true): readonly UICCraftActionDescriptor[] {
  return projectUICCraftActions(model.starredTabGroups, UIC_STARRED_CRAFT_RESOURCE_BUDGET.maxRows, enabled);
}

function projectUICCraftActions(items: readonly TabGroupWithSpace[], maxRows: number, enabled = true): readonly UICCraftActionDescriptor[] {
  if (!enabled) return [];
  const seen = new Set<string>();
  return items
    .filter(({ tg }) => {
      if (seen.has(tg.id)) return false;
      seen.add(tg.id);
      return true;
    })
    .slice(0, maxRows)
    .map(({ space, tg }) => ({
      event: "activate",
      id: "spaces.navigateToCraft",
      args: { spaceId: space.id, tabGroupId: tg.id },
      status: "available",
    }));
}

export function projectUICRecentlyVisitedCraftActions(model: SpacesOverviewSlotProps<"recentlyVisitedCraft">["model"], enabled = true): readonly UICCraftActionDescriptor[] {
  return projectUICCraftActions(model.recentlyVisited.items, UIC_RECENTLY_VISITED_CRAFT_RESOURCE_BUDGET.maxRows, enabled);
}

export function projectUICRecentlyCreatedCraftActions(model: SpacesOverviewSlotProps<"recentlyCreatedCraft">["model"], enabled = true): readonly UICCraftActionDescriptor[] {
  return projectUICCraftActions(model.recentlyCreated.items, UIC_RECENTLY_CREATED_CRAFT_RESOURCE_BUDGET.maxRows, enabled);
}

function UICReadOnlyStarredCraftSection({ model, actions, enableNavigateAction = true }: SpacesOverviewSlotProps<"starredCraft"> & { readonly enableNavigateAction?: boolean }) {
  const actionDescriptors = new Map(projectUICStarredCraftActions(model, enableNavigateAction).map((action) => [action.args.tabGroupId, action]));
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

function UICReadOnlyRecentlyVisitedCraftSection({ model, actions, enableNavigateAction = true }: SpacesOverviewSlotProps<"recentlyVisitedCraft"> & { readonly enableNavigateAction?: boolean }) {
  const actionDescriptors = new Map(projectUICRecentlyVisitedCraftActions(model, enableNavigateAction).map((action) => [action.args.tabGroupId, action]));
  return (
    <UICReadOnlyListSection
      slot="recently-visited-craft"
      title="Recently Visited"
      subtitle="Read-only UIC list"
      emptyLabel="No recently visited craft"
      countNoun="craft"
      countNounPlural="craft"
      resource={projectUICRecentlyVisitedCraftResource(model)}
      actionsByItemId={actionDescriptors}
      trustedActions={actions}
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

function UICReadOnlyRecentlyCreatedCraftSection({ model, actions, enableNavigateAction = true }: SpacesOverviewSlotProps<"recentlyCreatedCraft"> & { readonly enableNavigateAction?: boolean }) {
  const actionDescriptors = new Map(projectUICRecentlyCreatedCraftActions(model, enableNavigateAction).map((action) => [action.args.tabGroupId, action]));
  return (
    <UICReadOnlyListSection
      slot="recently-created-craft"
      title="Recently Created"
      subtitle="Read-only UIC list"
      emptyLabel="No recently created craft"
      countNoun="craft"
      countNounPlural="craft"
      resource={projectUICRecentlyCreatedCraftResource(model)}
      actionsByItemId={actionDescriptors}
      trustedActions={actions}
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

function projectUICWorkspaceActionTargets(model: Pick<SpacesOverviewSlotProps<"workspaceList">["model"], "sortedWorkspaces">): readonly DashboardWorkspace[] {
  const seen = new Set<string>();
  return model.sortedWorkspaces
    .filter((workspace) => {
      if (seen.has(workspace.id)) return false;
      seen.add(workspace.id);
      return true;
    })
    .slice(0, UIC_WORKSPACE_LIST_RESOURCE_BUDGET.maxRows);
}

export function projectUICWorkspaceListActions(
  model: Pick<SpacesOverviewSlotProps<"workspaceList">["model"], "effectiveRepos" | "selectedRepoId" | "sortedWorkspaces" | "workspacePage" | "workspaceTotalPages" | "canOpenWorkspaceInSpace">,
  enabled: Readonly<{ open: boolean; filter: boolean; page: boolean }> = { open: true, filter: true, page: true },
): readonly (UICWorkspaceActionDescriptor | UICWorkspaceFilterActionDescriptor | UICWorkspacePageActionDescriptor)[] {
  const actions: (UICWorkspaceActionDescriptor | UICWorkspaceFilterActionDescriptor | UICWorkspacePageActionDescriptor)[] = [];
  if (enabled.open && model.canOpenWorkspaceInSpace) {
    actions.push(...projectUICWorkspaceActionTargets(model).map((workspace) => ({
      event: "activate" as const,
      id: "spaces.openWorkspace" as const,
      args: { workspaceId: workspace.id },
      status: "available" as const,
    })));
  }
  if (enabled.filter && model.effectiveRepos.length > 0) {
    actions.push({ event: "filter", id: "spaces.filterWorkspaces", args: { repoId: "__all__" }, status: "available" });
    actions.push(...model.effectiveRepos.slice(0, UIC_WORKSPACE_LIST_RESOURCE_BUDGET.maxFilterRepos).map((repo) => ({
      event: "filter" as const,
      id: "spaces.filterWorkspaces" as const,
      args: { repoId: repo.id },
      status: "available" as const,
    })));
  }
  if (enabled.page && model.workspaceTotalPages > 1) {
    if (model.workspacePage > 0) actions.push({ event: "page", id: "spaces.pageWorkspaces", args: { direction: "previous", page: model.workspacePage - 1 }, status: "available" });
    if (model.workspacePage < model.workspaceTotalPages - 1) actions.push({ event: "page", id: "spaces.pageWorkspaces", args: { direction: "next", page: model.workspacePage + 1 }, status: "available" });
  }
  return actions;
}

function UICReadOnlyWorkspaceListSection({ model, actions, enableOpenWorkspaceAction = true, enableFilterAction = true, enablePageAction = true }: SpacesOverviewSlotProps<"workspaceList"> & { readonly enableOpenWorkspaceAction?: boolean; readonly enableFilterAction?: boolean; readonly enablePageAction?: boolean }) {
  const resource = projectUICWorkspaceListResource(model);
  const workspaceActions = projectUICWorkspaceListActions(model, { open: enableOpenWorkspaceAction, filter: enableFilterAction, page: enablePageAction });
  const actionDescriptors = new Map(workspaceActions.filter((action): action is UICWorkspaceActionDescriptor => action.id === "spaces.openWorkspace").map((action) => [action.args.workspaceId, action]));
  const filterActions = workspaceActions.filter((action): action is UICWorkspaceFilterActionDescriptor => action.id === "spaces.filterWorkspaces");
  const pageActions = workspaceActions.filter((action): action is UICWorkspacePageActionDescriptor => action.id === "spaces.pageWorkspaces");
  const allowedWorkspaces = new Map(projectUICWorkspaceActionTargets(model).map((workspace) => [workspace.id, workspace]));
  const allowedFilters = new Set(filterActions.map((action) => action.args.repoId));
  const allowedPages = new Map(pageActions.map((action) => [action.args.direction, action.args.page]));
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
      {filterActions.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {filterActions.map((action) => {
            const label = action.args.repoId === "__all__" ? "All" : model.effectiveRepos.find((repo) => repo.id === action.args.repoId)?.display_name || model.effectiveRepos.find((repo) => repo.id === action.args.repoId)?.name || action.args.repoId;
            const selected = (model.selectedRepoId ?? "__all__") === action.args.repoId;
            return (
              <button
                key={action.args.repoId}
                type="button"
                className={`myne-button rounded border px-3 py-1 text-xs ${selected ? "myne-button--accent" : "myne-button--quiet"}`}
                onClick={() => invokeUICWorkspaceListAction(actions, action, allowedWorkspaces, allowedFilters, allowedPages)}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
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
              {actionDescriptors.has(item.id) && (
                <button
                  type="button"
                  className="myne-button myne-button--quiet mt-2 text-xs"
                  onClick={() => {
                    const action = actionDescriptors.get(item.id);
                    if (action) invokeUICWorkspaceListAction(actions, action, allowedWorkspaces);
                  }}
                >
                  Open workspace
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {pageActions.length > 0 && (
        <div className="mt-4 flex gap-2">
          {pageActions.map((action) => (
            <button
              key={action.args.direction}
              type="button"
              className="myne-button myne-button--quiet rounded border px-3 py-1 text-xs"
              onClick={() => invokeUICWorkspaceListAction(actions, action, allowedWorkspaces, allowedFilters, allowedPages)}
            >
              {action.args.direction === "previous" ? "Previous" : "Next"}
            </button>
          ))}
        </div>
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

export function projectUICSpacesCraftActions(model: SpacesOverviewSlotProps<"spaces">["model"], enabled = true): readonly UICCraftActionDescriptor[] {
  if (!enabled) return [];
  const seen = new Set<string>();
  const seenSpaces = new Set<string>();
  return model.spacesWithTabGroups
    .filter(({ space }) => {
      if (seenSpaces.has(space.id)) return false;
      seenSpaces.add(space.id);
      return true;
    })
    .slice(0, UIC_SPACES_RESOURCE_BUDGET.maxSpaces)
    .flatMap(({ space, tabGroups }) =>
      tabGroups
        .filter((tg) => {
          if (seen.has(tg.id)) return false;
          seen.add(tg.id);
          return true;
        })
        .slice(0, UIC_SPACES_RESOURCE_BUDGET.maxCraftPerSpace)
        .map((tg) => ({
          event: "activate" as const,
          id: "spaces.navigateToCraft" as const,
          args: { spaceId: space.id, tabGroupId: tg.id },
          status: "available" as const,
        })),
  );
}

function UICReadOnlySpacesSection({ model, actions, enableNavigateAction = true }: SpacesOverviewSlotProps<"spaces"> & { readonly enableNavigateAction?: boolean }) {
  const resource = projectUICSpacesResource(model);
  const actionDescriptors = new Map(projectUICSpacesCraftActions(model, enableNavigateAction).map((action) => [action.args.tabGroupId, action]));
  const allowedTargets = new Set(Array.from(actionDescriptors.values()).map((action) => `${action.args.spaceId}:${action.args.tabGroupId}`));
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
                    {actions && actionDescriptors.has(item.id) && (
                      <button
                        type="button"
                        className="myne-button myne-button--quiet mt-2 text-xs"
                        onClick={() => {
                          const action = actionDescriptors.get(item.id);
                          if (action) invokeUICSpacesOverviewAction(actions, action, allowedTargets);
                        }}
                      >
                        Open craft
                      </button>
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

export function projectUICSpacePickerActions(
  model: Pick<SpacesOverviewSlotProps<"spacePicker">["model"], "workspace" | "spacePickerTarget" | "pendingOpenCraftRequest" | "openCraftRetryRequest" | "canOpenWorkspaceInSpace">,
  enabled: Readonly<{ close: boolean; retry: boolean; select: boolean }> = { close: true, retry: true, select: true },
): readonly (UICSpacePickerActionDescriptor | UICSpacePickerSelectActionDescriptor)[] {
  if (!model.spacePickerTarget || !model.canOpenWorkspaceInSpace) return [];
  if (model.pendingOpenCraftRequest) return [];
  const actions: (UICSpacePickerActionDescriptor | UICSpacePickerSelectActionDescriptor)[] = [];
  if (enabled.close && !model.pendingOpenCraftRequest) {
    actions.push({ event: "close", id: "spaces.dismissPicker", args: {}, status: "available" });
  }
  if (enabled.retry && model.openCraftRetryRequest && !model.pendingOpenCraftRequest) {
    actions.push({ event: "retry", id: "spaces.retryOpenWorkspace", args: {}, status: "available" });
  }
  if (enabled.select) {
    const seen = new Set<string>();
    for (const space of model.workspace.spaces) {
      if (seen.has(space.id)) continue;
      seen.add(space.id);
      actions.push({ event: "select", id: "spaces.selectSpaceForWorkspace", args: { spaceId: space.id }, status: "available" });
      if (actions.filter((action) => action.id === "spaces.selectSpaceForWorkspace").length >= UIC_SPACE_PICKER_RESOURCE_BUDGET.maxSpaces) break;
    }
  }
  return actions;
}

function UICSpacePickerModal({ model, actions, enableCloseAction = true, enableRetryAction = true, enableSelectAction = true }: SpacesOverviewSlotProps<"spacePicker"> & { readonly enableCloseAction?: boolean; readonly enableRetryAction?: boolean; readonly enableSelectAction?: boolean }) {
  const actionDescriptors = projectUICSpacePickerActions(model, { close: enableCloseAction, retry: enableRetryAction, select: enableSelectAction });
  if (!model.spacePickerTarget || !model.canOpenWorkspaceInSpace) return null;
  const allowedActions = new Set(actionDescriptors.map((action) => action.id));
  const closeAction = actionDescriptors.find((action) => action.id === "spaces.dismissPicker");
  const retryAction = actionDescriptors.find((action) => action.id === "spaces.retryOpenWorkspace");
  const selectActions = actionDescriptors.filter((action): action is UICSpacePickerSelectActionDescriptor => action.id === "spaces.selectSpaceForWorkspace");
  const allowedSpaceRequests = new Map(selectActions.map((action) => [action.args.spaceId, { workspace: model.spacePickerTarget!, spaceId: action.args.spaceId }]));
  const renderedSpaces = model.workspace.spaces
    .filter((space, index, spaces) => spaces.findIndex((candidate) => candidate.id === space.id) === index)
    .slice(0, UIC_SPACE_PICKER_RESOURCE_BUDGET.maxSpaces);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" data-myne-slot="space-picker-modal" data-uic-owned-region="space-picker" role="presentation">
      <section aria-label="UIC space picker" aria-modal="true" className="myne-dialog w-full max-w-sm rounded-xl border p-5 shadow-2xl" role="dialog">
        <MyneHeading className="text-sm font-semibold" level={2}>
          Open craft in space
        </MyneHeading>
        <MyneText as="p" className="mt-1 text-xs" tone="muted">
          {model.spacePickerTarget.name}
        </MyneText>
        {model.pendingOpenCraftRequest && (
          <MyneText as="p" className="myne-status myne-status--accent mt-3 text-xs">
            Opening…
          </MyneText>
        )}
        {model.openCraftActionError && (
          <MyneText as="p" className="myne-status myne-status--danger mt-3 text-xs" role="alert">
            {model.openCraftActionError}
          </MyneText>
        )}
        {selectActions.length > 0 && (
          <ul className="mt-4 space-y-1">
            {renderedSpaces.map((space) => {
              const selectAction = selectActions.find((action) => action.args.spaceId === space.id);
              if (!selectAction) return null;
              return (
                <li key={space.id}>
                  <button
                    type="button"
                    className="myne-row w-full rounded border px-3 py-2 text-left text-sm"
                    onClick={() => invokeUICSpacePickerAction(actions, selectAction, allowedActions, allowedSpaceRequests)}
                  >
                    {capUICResourceString(space.name, UIC_SPACE_PICKER_RESOURCE_BUDGET.maxSpaceLabelLength, [])}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-4 flex gap-2">
          {closeAction && (
            <button
              type="button"
              className="myne-button myne-button--quiet rounded border px-3 py-1.5 text-xs"
              onClick={() => invokeUICSpacePickerAction(actions, closeAction, allowedActions)}
            >
              Close picker
            </button>
          )}
          {retryAction && (
            <button
              type="button"
              className="myne-button myne-button--danger rounded border px-3 py-1.5 text-xs"
              onClick={() => invokeUICSpacePickerAction(actions, retryAction, allowedActions)}
            >
              Retry open
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

export function SpacesOverviewUICLayoutProofPresentation({
  xml = spacesOverviewUICLayoutXml,
  ...props
}: SpacesOverviewComponentProps & { readonly xml?: string }) {
  const diagnostics = validateUICXml(spacesOverviewPageHeaderUICProof, xml).diagnostics;
  const actionBindings = diagnostics.length ? new Map() : getUICValidatedActionBindings(spacesOverviewPageHeaderUICProof, xml);
  const enableSessionResume = actionBindings.get("recentSessions")?.resume === "spaces.resumeSession";
  const enableSessionStart = actionBindings.get("recentSessions")?.start === "spaces.startSession";
  const enableSessionRename = actionBindings.get("recentSessions")?.rename === "spaces.renameSession";
  const enableStarredNavigate = actionBindings.get("starredCraft")?.activate === "spaces.navigateToCraft";
  const enableRunningDevServerStop = actionBindings.get("runningDevServers")?.stop === "spaces.stopDevServer";
  const enableRecentlyVisitedNavigate = actionBindings.get("recentlyVisitedCraft")?.activate === "spaces.navigateToCraft";
  const enableRecentlyCreatedNavigate = actionBindings.get("recentlyCreatedCraft")?.activate === "spaces.navigateToCraft";
  const enableWorkspaceOpen = actionBindings.get("workspaceList")?.activate === "spaces.openWorkspace";
  const enableWorkspaceFilter = actionBindings.get("workspaceList")?.filter === "spaces.filterWorkspaces";
  const enableWorkspacePage = actionBindings.get("workspaceList")?.page === "spaces.pageWorkspaces";
  const enableSpacesNavigate = actionBindings.get("spaces")?.activate === "spaces.navigateToCraft";
  const enableSpacePickerClose = actionBindings.get("spacePicker")?.close === "spaces.dismissPicker";
  const enableSpacePickerRetry = actionBindings.get("spacePicker")?.retry === "spaces.retryOpenWorkspace";
  const enableSpacePickerSelect = actionBindings.get("spacePicker")?.select === "spaces.selectSpaceForWorkspace";
  const ui = diagnostics.length ? defaultSpacesOverviewUI : { ...defaultSpacesOverviewUI, RecentSessionsSection: (slotProps: SpacesOverviewSlotProps<"recentSessions">) => <UICReadOnlyRecentSessionsSection {...slotProps} enableResumeAction={enableSessionResume} enableStartAction={enableSessionStart} enableRenameAction={enableSessionRename} />, StarredCraftSection: (slotProps: SpacesOverviewSlotProps<"starredCraft">) => <UICReadOnlyStarredCraftSection {...slotProps} enableNavigateAction={enableStarredNavigate} />, RunningDevServersSection: (slotProps: SpacesOverviewSlotProps<"runningDevServers">) => <UICReadOnlyRunningDevServersSection {...slotProps} enableStopAction={enableRunningDevServerStop} />, RecentlyVisitedCraftSection: (slotProps: SpacesOverviewSlotProps<"recentlyVisitedCraft">) => <UICReadOnlyRecentlyVisitedCraftSection {...slotProps} enableNavigateAction={enableRecentlyVisitedNavigate} />, RecentlyCreatedCraftSection: (slotProps: SpacesOverviewSlotProps<"recentlyCreatedCraft">) => <UICReadOnlyRecentlyCreatedCraftSection {...slotProps} enableNavigateAction={enableRecentlyCreatedNavigate} />, WorkspaceListSection: (slotProps: SpacesOverviewSlotProps<"workspaceList">) => <UICReadOnlyWorkspaceListSection {...slotProps} enableOpenWorkspaceAction={enableWorkspaceOpen} enableFilterAction={enableWorkspaceFilter} enablePageAction={enableWorkspacePage} />, SpacesSection: (slotProps: SpacesOverviewSlotProps<"spaces">) => <UICReadOnlySpacesSection {...slotProps} enableNavigateAction={enableSpacesNavigate} />, SpacePickerModal: (slotProps: SpacesOverviewSlotProps<"spacePicker">) => <UICSpacePickerModal {...slotProps} enableCloseAction={enableSpacePickerClose} enableRetryAction={enableSpacePickerRetry} enableSelectAction={enableSpacePickerSelect} /> };

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
