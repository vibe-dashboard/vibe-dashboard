import { DefaultPageHeader, DefaultSpacesOverviewLayout, defaultSpacesOverviewUI } from "./DefaultSpacesOverview.view";
import type { SpacesOverviewComponentProps } from "./SpacesOverview.contracts";
import type { SpacesOverviewSlotProps } from "./SpacesOverview.slots";
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
  <uic:starredCraft />
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

type UICRunningDevServersResource =
  | { readonly state: "pending" }
  | { readonly state: "empty" }
  | { readonly state: "ready"; readonly items: readonly { readonly id: string; readonly name: string; readonly branch: string; readonly repoNames: readonly string[] }[]; readonly diagnostics: readonly string[] };

export const UIC_RUNNING_DEV_SERVERS_RESOURCE_BUDGET = Object.freeze({
  maxRows: 5,
  maxRepoLabelsPerRow: 2,
  maxLabelLength: 48,
  maxBranchLength: 64,
  maxRepoLabelLength: 32,
});

function capUICResourceString(value: string, max: number, diagnostics: string[]): string {
  if (value.length <= max) return value;
  diagnostics.push("uic/resource/string-truncated");
  return `${value.slice(0, max)}…`;
}

function projectUICRunningDevServersResource(model: SpacesOverviewSlotProps<"runningDevServers">["model"]): UICRunningDevServersResource {
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
      name: capUICResourceString(workspace.name, UIC_RUNNING_DEV_SERVERS_RESOURCE_BUDGET.maxLabelLength, diagnostics),
      branch: capUICResourceString(workspace.branch, UIC_RUNNING_DEV_SERVERS_RESOURCE_BUDGET.maxBranchLength, diagnostics),
      repoNames: workspace.repos
        .slice(0, UIC_RUNNING_DEV_SERVERS_RESOURCE_BUDGET.maxRepoLabelsPerRow)
        .map((repo) => capUICResourceString(repo.display_name || repo.name, UIC_RUNNING_DEV_SERVERS_RESOURCE_BUDGET.maxRepoLabelLength, diagnostics)),
    }));
  if (model.workspaces.filter((workspace) => workspace.has_running_dev_server).length > UIC_RUNNING_DEV_SERVERS_RESOURCE_BUDGET.maxRows) diagnostics.push("uic/resource/rows-truncated");
  if (model.workspaces.some((workspace) => workspace.has_running_dev_server && workspace.repos.length > UIC_RUNNING_DEV_SERVERS_RESOURCE_BUDGET.maxRepoLabelsPerRow)) diagnostics.push("uic/resource/repo-labels-truncated");
  return items.length ? { state: "ready", items, diagnostics: [...new Set(diagnostics)] } : { state: "empty" };
}

function UICReadOnlyRunningDevServersSection({ model }: SpacesOverviewSlotProps<"runningDevServers">) {
  const resource = projectUICRunningDevServersResource(model);

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
                {item.name}
              </MyneText>
              <MyneText as="span" className="mt-1 block break-all font-mono text-xs" tone="muted">
                {item.branch}
              </MyneText>
              {item.repoNames.length > 0 && (
                <MyneText as="span" className="mt-1 block text-xs" tone="muted">
                  {item.repoNames.join(", ")}
                </MyneText>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function SpacesOverviewUICLayoutProofPresentation({
  xml = spacesOverviewUICLayoutXml,
  ...props
}: SpacesOverviewComponentProps & { readonly xml?: string }) {
  const diagnostics = validateUICXml(spacesOverviewPageHeaderUICProof, xml).diagnostics;
  const ui = diagnostics.length ? defaultSpacesOverviewUI : { ...defaultSpacesOverviewUI, RunningDevServersSection: UICReadOnlyRunningDevServersSection };

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
