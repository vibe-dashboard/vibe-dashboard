import { describe, expect, it } from "vitest";
import { createCompositionRegistry, resolveComposition } from "./composition";

describe("typed composition registry", () => {
  it("resolves compatible per-slot overrides without coupling the skin", () => {
    const registry = createCompositionRegistry({
      surface: "example",
      version: 1,
      layouts: { "example.layout.default": () => null },
      components: {
        "example.header.default": { contractVersion: 1, component: () => null },
        "example.header.compact": { contractVersion: 1, component: () => null },
      },
    });
    const manifest = {
      surface: "example",
      version: 1 as const,
      layout: "example.layout.default",
      slots: { header: { component: "example.header.default", contractVersion: 1 } },
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
      layouts: { "example.layout.default": () => null },
      components: {
        "example.header.v2": { contractVersion: 2, component: () => null },
      },
    });
    const manifest = {
      surface: "example",
      version: 1 as const,
      layout: "example.layout.default",
      slots: { header: { component: "example.header.v2", contractVersion: 1 } },
    } as const;

    expect(() => resolveComposition(registry, manifest)).toThrow(
      /contract version 1/,
    );
    expect(() =>
      resolveComposition(registry, {
        ...manifest,
        slots: { header: { component: "missing", contractVersion: 1 } },
      } as never),
    ).toThrow(/not registered/);
  });
});
