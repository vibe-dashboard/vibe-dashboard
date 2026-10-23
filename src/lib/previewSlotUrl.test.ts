import { describe, expect, it } from "vitest";
import { buildPreviewSlotUrl } from "./previewSlotUrl";

const parts = {
  previewSlotId: "slot-1",
  workspaceToken: "0123456789abcdef",
  repoSlug: "repo",
  slotSlug: "web",
};

describe("canonical preview URLs", () => {
  it.each([
    ["https://jamtools.dev", "https://0123456789abcdef-repo-web.jamtools.dev/"],
    [
      "https://mickmister.jamtools.dev",
      "https://0123456789abcdef-repo-web-mickmister.jamtools.dev/",
    ],
    [
      "https://a.b.jamtools.dev",
      "https://0123456789abcdef-repo-web-a.b.jamtools.dev/",
    ],
    [
      "https://example.co.uk",
      "https://0123456789abcdef-repo-web.example.co.uk/",
    ],
    [
      "http://dev.example.co.uk:8080/path?query=1#hash",
      "http://0123456789abcdef-repo-web-dev.example.co.uk:8080/",
    ],
  ])("builds from %s", (origin, expected) => {
    expect(buildPreviewSlotUrl(parts, origin).url).toBe(expected);
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
