import { DefaultPageHeader, DefaultSpacesOverviewLayout, defaultSpacesOverviewUI } from "./DefaultSpacesOverview.view";
import type { SpacesOverviewComponentProps } from "./SpacesOverview.contracts";
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

export function SpacesOverviewUICLayoutProofPresentation({
  xml = spacesOverviewUICLayoutXml,
  ...props
}: SpacesOverviewComponentProps & { readonly xml?: string }) {
  const diagnostics = validateUICXml(spacesOverviewPageHeaderUICProof, xml).diagnostics;

  return (
    <>
      <DefaultSpacesOverviewLayout
        {...props}
        ui={defaultSpacesOverviewUI}
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
