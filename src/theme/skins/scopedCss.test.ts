import { describe, expect, it } from "vitest";
import {
  AppearanceArtifactRuntime,
  compileScopedAppearance,
  deriveProtectedTokens,
  type CompiledAppearanceArtifactV1,
} from "./scopedCss";

const valid = {
  packageId: "myne-user-ocean",
  cssBlocks: [{ id: "main", css: '.myne-card:hover, [data-myne-slot="workspace-list"] .myne-heading { color: #fff; border-radius: 8px; }' }],
  tokens: { "--myne-color-background": "#101820", "--myne-color-foreground": "#f8fafc", "--myne-color-accent": "#60a5fa", "--myne-color-danger": "#fb7185", "--myne-color-warning": "#facc15", "--myne-color-success": "#4ade80" },
};

describe("scoped appearance compiler", () => {
  it("AST-compiles deterministic canonical source below a collision-resistant opaque scope", async () => {
    const first = await compileScopedAppearance(valid);
    const second = await compileScopedAppearance({ ...valid, cssBlocks: [...valid.cssBlocks] });
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.artifact.scope).toMatch(/^myne-[a-f0-9]{24}$/);
    expect(first.artifact.cssText).toMatch(/^@layer myne\.candidate\{/);
    expect(first.artifact.cssText).toContain(`:where([data-myne-package-scope="${first.artifact.scope}"])`);
    expect(first.artifact.metadata).toMatchObject({ compilerVersion: 1, policyVersion: 1, parser: "css-tree@3.2.1" });
    expect(first.artifact.metadata.sourceDigest).toMatch(/^sha256-[A-Za-z0-9_-]{43}$/);
    expect(first.artifact.metadata.artifactDigest).toMatch(/^sha256-[A-Za-z0-9_-]{43}$/);
    expect(Object.isFrozen(first.artifact)).toBe(true);
  });

  it.each([
    [".myne-card{color:red!important}", "important-forbidden"],
    ["@layer evil{.myne-card{color:red}}", "at-rule-forbidden"],
    [".myne-card{background:url(javascript:alert(1))}", "resource-forbidden"],
    ["body .myne-card{color:red}", "selector-forbidden"],
    ["#app .myne-card{color:red}", "selector-forbidden"],
    [".myne-not-registered{color:red}", "selector-forbidden"],
    ['[data-myne-slot="not-registered"]{color:red}', "selector-forbidden"],
    ["[data-myne-protected]{display:none}", "protected-selector-forbidden"],
    [".myne-card{--myne-protected-foreground:#000}", "custom-property-forbidden"],
    [".myne-card{position:fixed;inset:0;z-index:999999}", "property-forbidden"],
    [".myne-button{pointer-events:none}", "property-forbidden"],
    [".myne-card{margin:-100px}", "layout-budget-exceeded"],
    [".myne-card{padding:999999px}", "layout-budget-exceeded"],
    ["@font-face{font-family:x;src:url(x.woff2)}", "at-rule-forbidden"],
    [".myne-card{animation:spin 99s infinite}", "property-forbidden"],
    [".myne-card{color:red", "css-parse-error"],
  ])("rejects an entire hostile package: %s", async (css, code) => {
    const result = await compileScopedAppearance({ ...valid, cssBlocks: [{ id: "attack", css }] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
    expect("artifact" in result).toBe(false);
  });

  it("enforces deterministic source and AST budgets", async () => {
    const manyRules = Array.from({ length: 257 }, (_, index) => `.myne-row:nth-child(${index + 1}){color:#fff}`).join("");
    const result = await compileScopedAppearance({ ...valid, cssBlocks: [{ id: "large", css: manyRules }] });
    expect(result).toMatchObject({ ok: false, diagnostics: [expect.objectContaining({ code: "budget-exceeded" })] });
  });

  it("fails closed for a deterministic adversarial mutation corpus", async () => {
    const attacks = ["@import'x'", "\\75rl(x)", "var(--myne-protected-focus)", "position:sticky", "display:none", "opacity:0", "content:'spoof'", "filter:blur(9px)", "transform:scale(99)", "animation:evil 1s", "behavior:url(x)"];
    for (let seed = 0; seed < 64; seed += 1) {
      const attack = attacks[(seed * 17) % attacks.length];
      const result = await compileScopedAppearance({ ...valid, cssBlocks: [{ id: `fuzz-${seed}`, css: `.myne-card{${seed % 2 ? attack : `color:red;${attack}`}}` }] });
      expect(result.ok, `seed ${seed}: ${attack}`).toBe(false);
    }
  });

  it("allows bounded responsive, forced-colors, and reduced-motion whole-surface styling", async () => {
    const result = await compileScopedAppearance({
      ...valid,
      cssBlocks: [{ id: "responsive", css: '@media (max-width: 60rem){.myne-section{padding:1rem}}@media (forced-colors: active){.myne-button:focus-visible{outline:2px solid CanvasText}}@media (prefers-reduced-motion: reduce){.myne-card{transition-duration:0s}}' }],
    });
    expect(result.ok).toBe(true);
  });
});

describe("protected tokens and activation", () => {
  it("derives accessible protected tokens and falls back atomically", () => {
    const safe = deriveProtectedTokens(valid.tokens);
    expect(safe.source).toBe("candidate");
    expect(safe.tokens["--myne-protected-focus-width"]).toBe("3px");
    expect(safe.tokens["--myne-protected-error-symbol"]).toBe('"!"');

    const fallback = deriveProtectedTokens({ ...valid.tokens, "--myne-color-foreground": "#111820" });
    expect(fallback.source).toBe("known-good");
    expect(fallback.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "protected-contrast" })]));
    expect(fallback.tokens).not.toEqual(safe.tokens);
  });

  it("compiles safe package CSS while atomically substituting known-good protected tokens", async () => {
    const result = await compileScopedAppearance({ ...valid, tokens: { ...valid.tokens, "--myne-color-foreground": "#111820" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ severity: "warning", code: "protected-contrast" })]));
    expect(result.artifact.protectedTokens["--myne-protected-foreground"]).toBe("#f4f4f5");
  });

  it("uses the identical immutable artifact for preview/activation and preserves last-known-good", async () => {
    const compiled = await compileScopedAppearance(valid);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const runtime = new AppearanceArtifactRuntime();
    const preview = runtime.preview(compiled.artifact);
    const active = runtime.activate(compiled.artifact);
    expect(preview.preview).toBe(active.active);
    expect(active.lastKnownGood).toBe(compiled.artifact);
    expect(runtime.rejectActivation("health-check-failed").active).toBe(compiled.artifact);
  });

  it("starts in safe mode without applying user CSS and exposes focus recovery", async () => {
    const compiled = await compileScopedAppearance(valid);
    if (!compiled.ok) throw new Error("fixture failed");
    const runtime = new AppearanceArtifactRuntime({ safeMode: true, lastKnownGood: compiled.artifact });
    expect(runtime.state.active).toBeUndefined();
    expect(runtime.state.lastKnownGood).toBe(compiled.artifact);
    expect(runtime.state.recovery).toEqual({ protected: true, focusTarget: "myne-appearance-recovery", keyboardShortcut: "Alt+Shift+R" });
  });

  it("never activates a mutable or structurally invalid artifact", () => {
    const runtime = new AppearanceArtifactRuntime();
    expect(() => runtime.activate({ cssText: "body{}" } as CompiledAppearanceArtifactV1)).toThrow("Invalid compiled appearance artifact");
    const forged = Object.freeze({ version: 1, packageId: "forged", scope: "myne-000000000000000000000000", cssText: '@layer myne.candidate{:where([data-myne-package-scope="myne-000000000000000000000000"]){color:red}}', protectedTokens: {}, metadata: { compilerVersion: 1, policyVersion: 1, parser: "css-tree@3.2.1", sourceDigest: "sha256-forged", artifactDigest: "sha256-forged", canonicalSourceBytes: 1 } }) as CompiledAppearanceArtifactV1;
    expect(() => runtime.activate(forged)).toThrow("Invalid compiled appearance artifact");
    expect(runtime.state.active).toBeUndefined();
  });
});
