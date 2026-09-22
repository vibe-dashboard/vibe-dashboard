import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { SpacesOverviewUICPageHeaderProof } from "./SpacesOverview.uic.view";

describe("SpacesOverview UIC pageHeader proof", () => {
  it("renders the dev-only pageHeader proof through existing public Myne hooks", () => {
    const html = renderToStaticMarkup(createElement(SpacesOverviewUICPageHeaderProof));

    expect(html).toContain("data-myne-slot=\"page-header\"");
    expect(html).toContain("Dashboard");
    expect(html).toContain("Workspace activity feed");
    expect(html).toContain("UIC pageHeader proof");
  });

  it("falls back to the trusted React pageHeader when XML validation fails", () => {
    const html = renderToStaticMarkup(createElement(SpacesOverviewUICPageHeaderProof, { xml: "<uic:component ref=\"x\" />" }));

    expect(html).toContain("data-myne-slot=\"page-header\"");
    expect(html).toContain("Dashboard");
    expect(html).toContain("uic/xml/generic-component-forbidden");
  });
});
