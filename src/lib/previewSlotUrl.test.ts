import { describe, expect, it } from "vitest";
import { buildPreviewSlotUrl } from "./previewSlotUrl";
import cases from "../../vibe-kanban/shared/preview-url-cases.json";

const parts = {
  previewSlotId: "slot-1",
  workspaceToken: "0123456789abcdef",
  repoSlug: "repo",
  slotSlug: "web",
};

describe("canonical preview URLs", () => {
  it.each(cases)("builds from $origin", ({ origin, url }) => {
    expect(buildPreviewSlotUrl(parts, origin).url).toBe(url);
  });

  it("requires a usable server origin and DNS-valid labels", () => {
    expect(() => buildPreviewSlotUrl(parts, undefined)).toThrow("SITE_ORIGIN");
    expect(() => buildPreviewSlotUrl(parts, "ftp://example.com")).toThrow(
      "HTTP",
    );
    expect(() => buildPreviewSlotUrl(parts, "http://127.0.0.1")).toThrow("DNS");
    expect(() =>
      buildPreviewSlotUrl(parts, `https://${"x".repeat(60)}.example.com`),
    ).toThrow("label limit");
  });
});
