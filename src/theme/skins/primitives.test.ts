import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  MyneAction,
  MyneBadge,
  MyneCard,
  MyneHeading,
  MyneIcon,
  MyneRow,
  MyneText,
} from "./primitives.view";

describe("skin-aware view primitives", () => {
  it("renders semantic text hooks without requiring manual data-vd attributes", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(MyneHeading, { level: 2 }, "Workspaces"),
        React.createElement(MyneText, { tone: "secondary" }, "2 active"),
        React.createElement(MyneText, { tone: "muted" }, "Last updated"),
        React.createElement(MyneText, { status: "success" }, "+42"),
      ),
    );

    expect(html).toContain("myne-text--primary");
    expect(html).toContain("myne-text--secondary");
    expect(html).toContain("myne-text--muted");
    expect(html).toContain("myne-status--success");
    expect(html).not.toContain("data-vd-");
  });

  it("renders component hooks for common skinnable view building blocks", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(MyneCard, null, "Card"),
        React.createElement(MyneRow, { as: "button", type: "button" }, "Row"),
        React.createElement(MyneAction, { tone: "danger", type: "button" }, "Delete"),
        React.createElement(MyneBadge, { status: "warning" }, "Waiting"),
        React.createElement(MyneIcon, { name: "chevron" }, "›"),
      ),
    );

    expect(html).toContain("myne-card");
    expect(html).toContain("myne-row");
    expect(html).toContain("myne-button myne-button--danger");
    expect(html).toContain("myne-badge myne-status--warning");
    expect(html).toContain("myne-icon myne-icon--chevron");
  });

  it("preserves native props and author class names", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        MyneAction,
        {
          "aria-label": "Open workspace",
          className: "rounded px-2",
          disabled: true,
          tone: "quiet",
          type: "button",
        },
        "Open",
      ),
    );

    expect(html).toContain("aria-label=\"Open workspace\"");
    expect(html).toContain("class=\"myne-button myne-button--quiet rounded px-2\"");
    expect(html).toContain("disabled=\"\"");
    expect(html).not.toContain("data-vd-");
  });

  it("defaults action buttons to non-submit buttons while preserving overrides", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(MyneAction, null, "Default action"),
        React.createElement(MyneAction, { type: "submit" }, "Submit action"),
        React.createElement(MyneAction, { type: "reset" }, "Reset action"),
      ),
    );

    expect(html).toMatch(/<button[^>]*type="button"/);
    expect(html).toMatch(/<button[^>]*type="submit"/);
    expect(html).toMatch(/<button[^>]*type="reset"/);
  });

  it("defaults button rows to non-submit buttons while preserving overrides", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(MyneRow, { as: "button" }, "Default row"),
        React.createElement(MyneRow, { as: "button", type: "submit" }, "Submit row"),
        React.createElement(MyneRow, { as: "button", type: "reset" }, "Reset row"),
      ),
    );

    expect(html).toMatch(/<button[^>]*type="button"/);
    expect(html).toMatch(/<button[^>]*type="submit"/);
    expect(html).toMatch(/<button[^>]*type="reset"/);
  });
});
