import { generate, parse, walk, type CssNode, type RuleNode } from "css-tree";
import type { MyneSkinDiagnostic } from "./types";

export const MYNE_SCOPED_CSS_COMPILER_VERSION = 1;
export const MYNE_SCOPED_CSS_POLICY_VERSION = 1;
export const MYNE_CASCADE_LAYERS = ["myne.reset", "myne.tokens", "myne.components", "myne.skin", "myne.candidate"] as const;

const LIMITS = Object.freeze({ sourceBytes: 64_000, rules: 256, declarations: 1_024, selectorBytes: 512, selectorDepth: 8, valueBytes: 1_024 });
const ALLOWED_PROPERTIES = new Set([
  "background", "background-color", "border", "border-color", "border-radius", "border-style", "border-width",
  "box-shadow", "color", "column-gap", "font-family", "font-size", "font-style", "font-weight", "gap",
  "grid-template-columns", "line-height", "letter-spacing", "margin", "margin-block", "margin-inline", "max-width",
  "min-height", "outline", "outline-color", "outline-offset", "outline-style", "outline-width", "padding",
  "padding-block", "padding-inline", "row-gap", "text-align", "text-decoration", "text-decoration-color",
  "text-decoration-thickness", "text-transform", "transition-duration", "transition-property", "transition-timing-function",
]);
const ALLOWED_PSEUDOS = new Set(["active", "checked", "disabled", "focus", "focus-visible", "hover", "nth-child"]);
const ALLOWED_TYPES = new Set(["article", "aside", "button", "div", "fieldset", "footer", "form", "h1", "h2", "h3", "header", "input", "label", "li", "main", "nav", "ol", "p", "section", "select", "span", "strong", "textarea", "ul"]);
const PUBLIC_CLASSES = new Set(["myne-theme", "myne-text", "myne-text--primary", "myne-text--secondary", "myne-text--muted", "myne-heading", "myne-status", "myne-status--accent", "myne-status--danger", "myne-status--success", "myne-status--warning", "myne-card", "myne-row", "myne-dialog", "myne-section", "myne-button", "myne-button--accent", "myne-button--danger", "myne-button--quiet", "myne-badge", "myne-icon", "myne-icon--chevron", "myne-state", "myne-state--loading", "myne-state--empty", "myne-state--error", "myne-preview-frame"]);
const PUBLIC_IDENTITIES: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  "data-myne-surface": new Set(["spaces-overview", "skin-editor"]),
  "data-myne-slot": new Set(["page-header", "workspace-list", "running-dev-servers", "space-picker-modal", "recent-sessions", "starred-craft", "recently-visited-craft", "recently-created-craft", "spaces-list", "skin-editor-header", "skin-editor-library", "skin-editor-editor", "skin-editor-preview", "skin-editor-import-export", "skin-editor-diagnostics"]),
  "data-myne-skin": new Set(["myne-default-dark", "myne-light-studio", "myne-high-contrast-terminal"]),
  "data-myne-view-pack": new Set(["myne.spaces.view-pack.default", "myne.spaces.view-pack.dense-workspace-list", "myne.appearance.view-pack.default", "myne.appearance.view-pack.compact-diagnostics"]),
});
const SAFE_VALUE = /^[\w\s#(),.%+\/'"*-]+$/;
const SAFE_TOKEN_VALUE = /^(?:#[0-9a-f]{3,8}|(?:0|\d+(?:\.\d+)?)(?:px|rem|em|%|s|ms)?|[a-zA-Z][\w\s,'".-]*)$/;
const VALID_ARTIFACTS = new WeakSet<object>();

export interface ScopedCssCompileInput {
  packageId: string;
  cssBlocks: readonly { id: string; css: string }[];
  tokens: Readonly<Record<string, string>>;
}

export interface CompiledAppearanceArtifactV1 {
  readonly version: 1;
  readonly packageId: string;
  readonly scope: string;
  readonly cssText: string;
  readonly protectedTokens: Readonly<Record<string, string>>;
  readonly metadata: Readonly<{
    compilerVersion: 1;
    policyVersion: 1;
    parser: "css-tree@3.2.1";
    sourceDigest: `sha256-${string}`;
    artifactDigest: `sha256-${string}`;
    canonicalSourceBytes: number;
  }>;
}

export type ScopedCssCompileResult =
  | { ok: true; artifact: CompiledAppearanceArtifactV1; diagnostics: readonly MyneSkinDiagnostic[] }
  | { ok: false; diagnostics: readonly MyneSkinDiagnostic[] };

function error(code: string, message: string, path?: string): MyneSkinDiagnostic {
  return { severity: "error", code, message, ...(path ? { path } : {}) };
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function hasBalancedCssDelimiters(source: string): boolean {
  const stack: string[] = [];
  let quote = "";
  let comment = false;
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (comment) {
      if (current === "*" && next === "/") { comment = false; index += 1; }
      continue;
    }
    if (quote) {
      if (current === "\\") { index += 1; continue; }
      if (current === quote) quote = "";
      continue;
    }
    if (current === "/" && next === "*") { comment = true; index += 1; continue; }
    if (current === '"' || current === "'") { quote = current; continue; }
    if (current === "{" || current === "(" || current === "[") stack.push(current);
    if (current === "}" || current === ")" || current === "]") {
      const expected = current === "}" ? "{" : current === ")" ? "(" : "[";
      if (stack.pop() !== expected) return false;
    }
  }
  return !comment && !quote && stack.length === 0;
}

async function sha256(value: string): Promise<{ base64url: string; hex: string }> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return {
    base64url: btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""),
    hex: [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
  };
}

function validateSelector(selector: string, diagnostics: MyneSkinDiagnostic[], path: string): boolean {
  if (utf8Length(selector) > LIMITS.selectorBytes) {
    diagnostics.push(error("budget-exceeded", "Selector exceeds the byte budget.", path));
    return false;
  }
  if (/(?:^|[\s>+~,(])(?:html|body|:root|\*|#)|data-myne-protected|myne-protected|::|:has\(|:is\(|:where\(|:not\(/i.test(selector)) {
    diagnostics.push(error(selector.includes("protected") ? "protected-selector-forbidden" : "selector-forbidden", "Selector escapes the registered public @myne vocabulary.", path));
    return false;
  }
  const depth = (selector.match(/[ >+~]/g) ?? []).length + 1;
  if (depth > LIMITS.selectorDepth) {
    diagnostics.push(error("budget-exceeded", "Selector exceeds the combinator-depth budget.", path));
    return false;
  }
  const selectorAst = parse(selector, { context: "selector" });
  let publicAnchor = false;
  let valid = true;
  walk(selectorAst, (node) => {
    if (node.type === "ClassSelector") {
      const name = String(node.name);
      if (!PUBLIC_CLASSES.has(name)) valid = false;
      else publicAnchor = true;
    } else if (node.type === "AttributeSelector") {
      const serialized = generate(node);
      const match = /^\[([a-z-]+)="([a-z0-9._-]+)"\]$/.exec(serialized);
      if (!match || !PUBLIC_IDENTITIES[match[1]!]?.has(match[2]!)) valid = false;
      else publicAnchor = true;
    } else if (node.type === "TypeSelector" && !ALLOWED_TYPES.has(String(node.name).toLowerCase())) valid = false;
    else if (node.type === "PseudoClassSelector" && !ALLOWED_PSEUDOS.has(String(node.name).toLowerCase())) valid = false;
    else if (node.type === "IdSelector" || node.type === "PseudoElementSelector") valid = false;
  });
  if (!valid || !publicAnchor) diagnostics.push(error("selector-forbidden", "Every selector must stay under an exact registered public class or data-myne identity.", path));
  return valid && publicAnchor;
}

function validateMedia(prelude: string): boolean {
  return /^\((?:max-width|min-width):\s*(?:\d+(?:\.\d+)?)(?:px|rem)\)$/.test(prelude)
    || /^\(forced-colors:\s*active\)$/.test(prelude)
    || /^\(prefers-reduced-motion:\s*reduce\)$/.test(prelude);
}

function hasUnsafeMagnitude(value: string): boolean {
  if (/(?:^|[^\w])-\d/.test(value)) return true;
  for (const match of value.matchAll(/(\d+(?:\.\d+)?)(px|rem|em|%)/g)) {
    const amount = Number(match[1]);
    const unit = match[2];
    if ((unit === "px" && amount > 4096) || ((unit === "rem" || unit === "em") && amount > 256) || (unit === "%" && amount > 100)) return true;
  }
  return false;
}

function validateAndRewriteAst(ast: CssNode, scope: string, diagnostics: MyneSkinDiagnostic[]): void {
  let rules = 0;
  let declarations = 0;
  walk(ast, {
    enter(node) {
      if (node.type === "Atrule") {
        const name = String(node.name).toLowerCase();
        const prelude = node.prelude ? generate(node.prelude as CssNode) : "";
        if (name !== "media" || !validateMedia(prelude)) diagnostics.push(error("at-rule-forbidden", `@${name} is not allowed by scoped CSS policy v1.`));
      } else if (node.type === "Rule") {
        rules += 1;
        const rule = node as RuleNode;
        if (rule.prelude.type !== "SelectorList") {
          diagnostics.push(error("selector-forbidden", "Only ordinary qualified selectors are allowed."));
          return;
        }
        const selectors = generate(rule.prelude).split(",").map((item) => item.trim());
        if (selectors.every((selector, index) => validateSelector(selector, diagnostics, `selectors.${rules - 1}.${index}`))) {
          const scoped = selectors.map((selector) => `:where([data-myne-package-scope="${scope}"]) ${selector}`).join(",");
          rule.prelude = parse(scoped, { context: "selectorList" });
        }
      } else if (node.type === "Declaration") {
        declarations += 1;
        const property = String(node.property).toLowerCase();
        const value = generate(node.value as CssNode);
        if (node.important) diagnostics.push(error("important-forbidden", "Package declarations cannot use !important.", property));
        if (property.startsWith("--")) {
          if (!property.startsWith("--myne-package-")) diagnostics.push(error("custom-property-forbidden", "Packages may define only --myne-package-* private custom properties.", property));
        } else if (!ALLOWED_PROPERTIES.has(property)) diagnostics.push(error("property-forbidden", `Property \"${property}\" is not allowed by policy v1.`, property));
        if (utf8Length(value) > LIMITS.valueBytes) diagnostics.push(error("budget-exceeded", "Declaration value exceeds the byte budget.", property));
        if (/url\s*\(|expression\s*\(|javascript:|@import|behavior\s*:/i.test(value)) diagnostics.push(error("resource-forbidden", "External and executable CSS resources are forbidden.", property));
        if (!SAFE_VALUE.test(value)) diagnostics.push(error("value-forbidden", "Declaration value contains syntax outside policy v1.", property));
        if (hasUnsafeMagnitude(value)) diagnostics.push(error("layout-budget-exceeded", "Negative or oversized layout values are forbidden.", property));
        if (property === "transition-duration" && !/^(?:0s|0ms|(?:[0-5](?:\.\d+)?)s|(?:\d|[1-9]\d|[1-9]\d\d|1000)ms)$/.test(value)) diagnostics.push(error("property-forbidden", "Transition duration must be bounded to five seconds.", property));
      }
    },
  });
  if (rules > LIMITS.rules || declarations > LIMITS.declarations) diagnostics.push(error("budget-exceeded", "Stylesheet exceeds rule or declaration budgets."));
}

function canonicalTokens(tokens: Readonly<Record<string, string>>, diagnostics: MyneSkinDiagnostic[]): string {
  return Object.entries(tokens).sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => {
    if (!/^--myne-(?:color|font|text|density|space|radius|shadow|control|row|surface|component|slot)-[a-z0-9-]+$/.test(name) || name.startsWith("--myne-protected-")) diagnostics.push(error("token-forbidden", `Token \"${name}\" is outside the published token vocabulary.`, name));
    if (!SAFE_TOKEN_VALUE.test(value) || /url\s*\(|javascript:|expression\s*\(/i.test(value)) diagnostics.push(error("token-value-forbidden", `Token \"${name}\" has an unsafe value.`, name));
    return `${name}:${value}`;
  }).join(";");
}

export async function compileScopedAppearance(input: ScopedCssCompileInput): Promise<ScopedCssCompileResult> {
  const diagnostics: MyneSkinDiagnostic[] = [];
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(input.packageId)) diagnostics.push(error("invalid-package-id", "packageId must be a stable lowercase id.", "packageId"));
  const duplicateBlock = input.cssBlocks.find((block, index) => input.cssBlocks.findIndex((other) => other.id === block.id) !== index);
  if (duplicateBlock) diagnostics.push(error("duplicate-css-block", `CSS block \"${duplicateBlock.id}\" is duplicated.`, "cssBlocks"));
  const source = [...input.cssBlocks].sort((a, b) => a.id.localeCompare(b.id)).map((block) => block.css.trim()).join("\n");
  if (utf8Length(source) > LIMITS.sourceBytes) diagnostics.push(error("budget-exceeded", "Canonical CSS source exceeds 64KB."));
  if (!hasBalancedCssDelimiters(source)) diagnostics.push(error("css-parse-error", "CSS source contains unbalanced delimiters, strings, or comments."));
  if (/url\s*\(|expression\s*\(|javascript:/i.test(source)) diagnostics.push(error("resource-forbidden", "External and executable CSS resources are forbidden."));
  const tokenDeclarations = canonicalTokens(input.tokens, diagnostics);
  let ast: CssNode | undefined;
  try {
    ast = parse(source, {
      context: "stylesheet",
      positions: false,
      onParseError(parseError) {
        diagnostics.push(error("css-parse-error", parseError.formattedMessage));
      },
    });
  } catch (cause) {
    diagnostics.push(error("css-parse-error", cause instanceof Error ? cause.message : "CSS parser rejected the source."));
  }
  if (!ast) return { ok: false, diagnostics };
  const canonicalSource = generate(ast);
  const sourceDigest = await sha256(canonicalSource);
  const artifactDigest = await sha256(`${MYNE_SCOPED_CSS_COMPILER_VERSION}\n${MYNE_SCOPED_CSS_POLICY_VERSION}\n${input.packageId}\n${canonicalSource}\n${tokenDeclarations}`);
  const scope = `myne-${artifactDigest.hex.slice(0, 24)}`;
  validateAndRewriteAst(ast, scope, diagnostics);
  const protectedProjection = deriveProtectedTokens(input.tokens);
  if (diagnostics.length) return { ok: false, diagnostics };
  const projectionDiagnostics = protectedProjection.diagnostics.map((item) => ({ ...item, severity: "warning" as const }));
  const scopedTokens = tokenDeclarations ? `:where([data-myne-package-scope="${scope}"]){${tokenDeclarations}}` : "";
  const cssText = `@layer myne.candidate{${scopedTokens}${generate(ast)}}`;
  const metadata = Object.freeze({ compilerVersion: 1 as const, policyVersion: 1 as const, parser: "css-tree@3.2.1" as const, sourceDigest: `sha256-${sourceDigest.base64url}` as const, artifactDigest: `sha256-${artifactDigest.base64url}` as const, canonicalSourceBytes: utf8Length(canonicalSource) });
  const artifact = Object.freeze({ version: 1 as const, packageId: input.packageId, scope, cssText, protectedTokens: protectedProjection.tokens, metadata });
  VALID_ARTIFACTS.add(artifact);
  return { ok: true, artifact, diagnostics: Object.freeze(projectionDiagnostics) };
}

const KNOWN_GOOD_PROTECTED_TOKENS = Object.freeze({
  "--myne-protected-background": "#09090b", "--myne-protected-foreground": "#f4f4f5", "--myne-protected-focus": "#60a5fa",
  "--myne-protected-danger": "#f87171", "--myne-protected-warning": "#fbbf24", "--myne-protected-success": "#4ade80",
  "--myne-protected-disabled-pattern": "repeating-linear-gradient(135deg, transparent 0 3px, currentColor 3px 4px)",
  "--myne-protected-focus-width": "3px", "--myne-protected-error-symbol": '"!"', "--myne-protected-warning-symbol": '"▲"',
  "--myne-protected-confirmation-symbol": '"✓"', "--myne-protected-motion-duration": "0ms",
});

function rgb(hex: string): [number, number, number] | undefined {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return undefined;
  const value = Number.parseInt(match[1]!, 16);
  return [value >> 16, (value >> 8) & 255, value & 255];
}

function luminance(hex: string): number | undefined {
  const color = rgb(hex);
  if (!color) return undefined;
  const convert = (channel: number) => { const normalized = channel / 255; return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4; };
  return convert(color[0]) * 0.2126 + convert(color[1]) * 0.7152 + convert(color[2]) * 0.0722;
}

function contrast(a: string, b: string): number {
  const left = luminance(a); const right = luminance(b);
  if (left === undefined || right === undefined) return 0;
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}

export function deriveProtectedTokens(tokens: Readonly<Record<string, string>>): { source: "candidate" | "known-good"; tokens: Readonly<Record<string, string>>; diagnostics: readonly MyneSkinDiagnostic[] } {
  const background = tokens["--myne-color-background"];
  const foreground = tokens["--myne-color-foreground"];
  const focus = tokens["--myne-color-accent"];
  const danger = tokens["--myne-color-danger"];
  const warning = tokens["--myne-color-warning"];
  const success = tokens["--myne-color-success"];
  const diagnostics: MyneSkinDiagnostic[] = [];
  if (!background || !foreground || contrast(background, foreground) < 4.5) diagnostics.push(error("protected-contrast", "Protected foreground/background contrast must be at least 4.5:1."));
  for (const [name, color] of [["focus", focus], ["danger", danger], ["warning", warning], ["success", success]] as const) {
    if (!background || !color || contrast(background, color) < 3) diagnostics.push(error("protected-state-contrast", `Protected ${name} contrast must be at least 3:1.`));
  }
  if (new Set([focus, danger, warning, success]).size !== 4) diagnostics.push(error("protected-state-distinction", "Focus, danger, warning, and success colors must remain distinct."));
  if (diagnostics.length) return { source: "known-good", tokens: KNOWN_GOOD_PROTECTED_TOKENS, diagnostics };
  if (!background || !foreground || !focus || !danger || !warning || !success) return { source: "known-good", tokens: KNOWN_GOOD_PROTECTED_TOKENS, diagnostics: [error("protected-token-missing", "Protected token projection is incomplete.")] };
  return { source: "candidate", diagnostics: [], tokens: Object.freeze({
    "--myne-protected-background": background, "--myne-protected-foreground": foreground, "--myne-protected-focus": focus,
    "--myne-protected-danger": danger, "--myne-protected-warning": warning, "--myne-protected-success": success,
    ...Object.fromEntries(Object.entries(KNOWN_GOOD_PROTECTED_TOKENS).filter(([name]) => !["--myne-protected-background", "--myne-protected-foreground", "--myne-protected-focus", "--myne-protected-danger", "--myne-protected-warning", "--myne-protected-success"].includes(name))),
  }) };
}

export interface AppearanceRuntimeState {
  readonly safeMode: boolean;
  readonly preview?: CompiledAppearanceArtifactV1;
  readonly active?: CompiledAppearanceArtifactV1;
  readonly lastKnownGood?: CompiledAppearanceArtifactV1;
  readonly diagnostic?: string;
  readonly recovery: { readonly protected: true; readonly focusTarget: "myne-appearance-recovery"; readonly keyboardShortcut: "Alt+Shift+R" };
}

const RECOVERY = Object.freeze({ protected: true as const, focusTarget: "myne-appearance-recovery" as const, keyboardShortcut: "Alt+Shift+R" as const });

function assertArtifact(artifact: CompiledAppearanceArtifactV1): void {
  if (!VALID_ARTIFACTS.has(artifact) || !Object.isFrozen(artifact) || artifact.version !== 1 || !artifact.cssText.startsWith("@layer myne.candidate{") || !artifact.cssText.includes(`[data-myne-package-scope=\"${artifact.scope}\"]`) || artifact.metadata?.compilerVersion !== 1 || artifact.metadata.policyVersion !== 1) throw new TypeError("Invalid compiled appearance artifact");
}

export class AppearanceArtifactRuntime {
  #state: AppearanceRuntimeState;
  constructor(options: { safeMode?: boolean; lastKnownGood?: CompiledAppearanceArtifactV1 } = {}) {
    if (options.lastKnownGood) assertArtifact(options.lastKnownGood);
    this.#state = Object.freeze({ safeMode: options.safeMode ?? false, ...(options.lastKnownGood ? { lastKnownGood: options.lastKnownGood } : {}), recovery: RECOVERY });
  }
  get state(): AppearanceRuntimeState { return this.#state; }
  preview(artifact: CompiledAppearanceArtifactV1): AppearanceRuntimeState {
    assertArtifact(artifact);
    this.#state = Object.freeze({ ...this.#state, preview: artifact, diagnostic: undefined });
    return this.#state;
  }
  activate(artifact: CompiledAppearanceArtifactV1): AppearanceRuntimeState {
    assertArtifact(artifact);
    if (this.#state.safeMode) throw new Error("Appearance activation is disabled in safe mode.");
    this.#state = Object.freeze({ ...this.#state, preview: artifact, active: artifact, lastKnownGood: artifact, diagnostic: undefined });
    return this.#state;
  }
  rejectActivation(reason: string): AppearanceRuntimeState {
    this.#state = Object.freeze({ ...this.#state, active: this.#state.lastKnownGood, diagnostic: reason });
    return this.#state;
  }
}

export function installProtectedAppearanceRecovery(target: Document): () => void {
  const recover = (event: KeyboardEvent) => {
    if (event.altKey && event.shiftKey && event.key.toLowerCase() === "r") {
      event.preventDefault();
      target.getElementById(RECOVERY.focusTarget)?.focus();
    }
  };
  target.addEventListener("keydown", recover);
  return () => target.removeEventListener("keydown", recover);
}
