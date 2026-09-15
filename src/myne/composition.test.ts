import { describe, expect, it } from "vitest";
import { createCompositionRegistry, resolveComposition } from "./composition";

describe("typed composition registry", () => {
  it("resolves compatible per-slot overrides without coupling the skin", () => {
    const registry = createCompositionRegistry({
      surface: "example",
      version: 1,
      requiredSlots: ["header", "body"] as const,
      layouts: { "example.layout.default": () => null },
      components: {
        "example.header.default": { slot: "header", contractVersion: 2, component: () => null },
        "example.header.compact": { slot: "header", contractVersion: 2, component: () => null },
        "example.body.default": { slot: "body", contractVersion: 1, component: () => null },
      },
    });
    const manifest = {
      surface: "example",
      version: 1 as const,
      layout: "example.layout.default",
      slots: {
        header: { slot: "header", component: "example.header.default", contractVersion: 2 },
        body: { slot: "body", component: "example.body.default", contractVersion: 1 },
      },
    } as const;

    const resolved = resolveComposition(registry, manifest, {
      header: "example.header.compact",
    });

    expect(resolved.viewPackId).toBeUndefined();
    expect(resolved.components.header).toBe(
      registry.components["example.header.compact"]?.component,
    );
  });

  it("rejects unknown renderers and incompatible slot contracts", () => {
    const registry = createCompositionRegistry({
      surface: "example",
      version: 1,
      requiredSlots: ["header"] as const,
      layouts: { "example.layout.default": () => null },
      components: {
        "example.header.v2": { slot: "header", contractVersion: 2, component: () => null },
      },
    });
    const manifest = {
      surface: "example",
      version: 1 as const,
      layout: "example.layout.default",
      slots: { header: { slot: "header", component: "example.header.v2", contractVersion: 1 } },
    } as const;

    expect(() => resolveComposition(registry, manifest)).toThrow(
      /contract version 1/,
    );
    expect(() =>
      resolveComposition(registry, {
        ...manifest,
        slots: { header: { slot: "header", component: "missing", contractVersion: 1 } },
      } as never),
    ).toThrow(/not registered/);
  });

  it.each([
    ["missing required slot", {}, {}, /missing required slot header/],
    ["extra slot", { header: { slot: "header", component: "example.header", contractVersion: 1 }, body: { slot: "body", component: "example.body", contractVersion: 1 }, footer: { slot: "footer", component: "example.body", contractVersion: 1 } }, {}, /unknown slot footer/],
    ["identity mismatch", { header: { slot: "body", component: "example.header", contractVersion: 1 }, body: { slot: "body", component: "example.body", contractVersion: 1 } }, {}, /identity.*header/i],
    ["same-version cross-slot component", { header: { slot: "header", component: "example.body", contractVersion: 1 }, body: { slot: "body", component: "example.body", contractVersion: 1 } }, {}, /registered for body.*not header/i],
    ["unknown override slot", { header: { slot: "header", component: "example.header", contractVersion: 1 }, body: { slot: "body", component: "example.body", contractVersion: 1 } }, { footer: "example.body" }, /unknown override slot footer/],
  ])("rejects %s before returning renderers", (_label, slots, overrides, error) => {
    const registry = createCompositionRegistry({
      surface: "example",
      version: 1,
      requiredSlots: ["header", "body"] as const,
      layouts: { "example.layout.default": () => null },
      components: {
        "example.header": { slot: "header", contractVersion: 1, component: () => null },
        "example.body": { slot: "body", contractVersion: 1, component: () => null },
      },
    });
    expect(() => resolveComposition(registry, {
      surface: "example",
      version: 1,
      layout: "example.layout.default",
      slots,
    } as never, overrides as never)).toThrow(error);
  });
});
