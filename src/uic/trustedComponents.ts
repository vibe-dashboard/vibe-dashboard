export const UIC_XML_NAMESPACE_V1 = "https://vibedashboard.dev/uic/xml/v1";

export type UICAdapterKind = "trusted-react" | "wrapper";

export interface UICComponentDescriptor {
  readonly tag: string;
  readonly componentId: string;
  readonly adapter: UICAdapterKind;
  readonly props: readonly string[];
  readonly events?: Readonly<Record<string, readonly string[]>>;
  readonly slots?: Readonly<Record<string, readonly string[]>>;
  readonly externalLibrary?: Readonly<{ name: "HeroUI"; exposure: "wrapped-only" }>;
  readonly forbidden: readonly string[];
  readonly fallback: "node" | "enclosing-slot";
}

export interface UICSurfaceDescriptor {
  readonly artifactVersion: 1;
  readonly surface: "spaces-overview";
  readonly rootTag: "spaceOverviewPage";
  readonly namespace: typeof UIC_XML_NAMESPACE_V1;
  readonly layoutTags: readonly string[];
  readonly components: Readonly<Record<string, UICComponentDescriptor>>;
}

export interface UICDiagnostic {
  readonly code: string;
  readonly message: string;
}

export type UICPropValue =
  | Readonly<{ kind: "literal"; value: string }>
  | Readonly<{ kind: "binding"; path: string }>;

export interface UICIRNode {
  readonly tag: string;
  readonly componentId: string;
  readonly adapter: UICAdapterKind;
  readonly props: Readonly<Record<string, UICPropValue>>;
  readonly actions?: Readonly<Record<string, string>>;
  readonly slots?: Readonly<Record<string, readonly UICIRNode[]>>;
}

export interface UICTemplateIR {
  readonly artifactVersion: 1;
  readonly surface: "spaces-overview";
  readonly rootTag: "spaceOverviewPage";
  readonly namespace: typeof UIC_XML_NAMESPACE_V1;
  readonly schemaDigest: `sha256-${string}`;
  readonly registryDigest: `sha256-${string}`;
  readonly css: string;
  readonly nodes: readonly UICIRNode[];
}

export type UICLayoutPrimitiveTag = "layout" | "region" | "stack" | "grid" | "split" | "card";
export type UICLayoutTreeNode =
  | Readonly<{ kind: "slot"; tag: string }>
  | Readonly<{ kind: "primitive"; tag: UICLayoutPrimitiveTag; attrs: Readonly<Record<string, string>>; children: readonly UICLayoutTreeNode[] }>;
export type UICCraftListRowTemplate = Readonly<{
  sectionTag: "recentlyCreatedCraft";
  row: Readonly<{
    variant: "standard" | "featured";
    children: readonly UICCraftListRowTemplateChild[];
  }>;
}>;
export type UICCraftListRowTemplateChild =
  | Readonly<{ kind: "text"; bind: "item.label" | "item.meta"; tone: "primary" | "secondary" | "muted" }>
  | Readonly<{ kind: "action"; event: "activate"; label: string }>;

const UIC_STRUCTURAL_TAGS = Object.freeze(["layout", "region", "stack", "grid", "split", "card"] satisfies readonly UICLayoutPrimitiveTag[]);
const UIC_STRUCTURAL_TAG_SET = new Set<string>(UIC_STRUCTURAL_TAGS);
const UIC_ROW_TEMPLATE_TAGS = Object.freeze(["rowTemplate", "row", "text", "action"] as const);
const UIC_ROW_TEMPLATE_TAG_SET = new Set<string>(UIC_ROW_TEMPLATE_TAGS);
const UIC_LAYOUT_MAX_DEPTH = 8;
const UIC_LAYOUT_MAX_NODES = 40;
const UIC_ROW_TEMPLATE_MAX_DEPTH = 3;
const UIC_ROW_TEMPLATE_MAX_NODES = 8;

export const spacesOverviewPageHeaderUICProof: UICSurfaceDescriptor = Object.freeze({
  artifactVersion: 1,
  surface: "spaces-overview",
  rootTag: "spaceOverviewPage",
  namespace: UIC_XML_NAMESPACE_V1,
  layoutTags: Object.freeze(["pageHeader", "recentSessions", "starredCraft", "runningDevServers", "recentlyVisitedCraft", "recentlyCreatedCraft", "workspaceList", "spaces", "spacePicker"]),
  components: Object.freeze({
    pageHeader: Object.freeze({
      tag: "pageHeader",
      componentId: "myne.spaces.page-header.default",
      adapter: "trusted-react",
      props: Object.freeze(["title", "subtitle"]),
      slots: Object.freeze({ actions: Object.freeze(["pageHeaderAction"]) }),
      forbidden: Object.freeze(["class", "className", "style"]),
      fallback: "enclosing-slot",
    }),
    pageHeaderAction: Object.freeze({
      tag: "pageHeaderAction",
      componentId: "uic.heroui.button.action",
      adapter: "wrapper",
      externalLibrary: Object.freeze({ name: "HeroUI", exposure: "wrapped-only" }),
      props: Object.freeze(["label"]),
      forbidden: Object.freeze(["class", "className", "style", "onPress", "href", "as"]),
      fallback: "node",
    }),
    recentSessions: Object.freeze({
      tag: "recentSessions",
      componentId: "myne.spaces.recent-sessions.default",
      adapter: "trusted-react",
      props: Object.freeze([]),
      events: Object.freeze({
        resume: Object.freeze(["spaces.resumeSession"]),
        start: Object.freeze(["spaces.startSession"]),
        rename: Object.freeze(["spaces.renameSession"]),
        delete: Object.freeze(["spaces.deleteSession"]),
        toggle: Object.freeze(["spaces.toggleSession"]),
        activate: Object.freeze(["spaces.navigateToCraft"]),
      }),
      forbidden: Object.freeze(["class", "className", "style"]),
      fallback: "enclosing-slot",
    }),
    starredCraft: Object.freeze({
      tag: "starredCraft",
      componentId: "myne.spaces.starred-craft.default",
      adapter: "trusted-react",
      props: Object.freeze([]),
      events: Object.freeze({ activate: Object.freeze(["spaces.navigateToCraft"]) }),
      forbidden: Object.freeze(["class", "className", "style"]),
      fallback: "enclosing-slot",
    }),
    runningDevServers: Object.freeze({
      tag: "runningDevServers",
      componentId: "myne.spaces.running-dev-servers.default",
      adapter: "trusted-react",
      props: Object.freeze([]),
      events: Object.freeze({
        stop: Object.freeze(["spaces.stopDevServer"]),
        activate: Object.freeze(["spaces.navigateToCraft"]),
        open: Object.freeze(["spaces.openWorkspace"]),
      }),
      forbidden: Object.freeze(["class", "className", "style"]),
      fallback: "enclosing-slot",
    }),
    recentlyVisitedCraft: Object.freeze({
      tag: "recentlyVisitedCraft",
      componentId: "myne.spaces.recently-visited.default",
      adapter: "trusted-react",
      props: Object.freeze([]),
      events: Object.freeze({ activate: Object.freeze(["spaces.navigateToCraft"]), page: Object.freeze(["spaces.pageRecentlyVisitedCraft"]) }),
      forbidden: Object.freeze(["class", "className", "style"]),
      fallback: "enclosing-slot",
    }),
    recentlyCreatedCraft: Object.freeze({
      tag: "recentlyCreatedCraft",
      componentId: "myne.spaces.recently-created.default",
      adapter: "trusted-react",
      props: Object.freeze([]),
      events: Object.freeze({ activate: Object.freeze(["spaces.navigateToCraft"]), page: Object.freeze(["spaces.pageRecentlyCreatedCraft"]) }),
      forbidden: Object.freeze(["class", "className", "style"]),
      fallback: "enclosing-slot",
    }),
    workspaceList: Object.freeze({
      tag: "workspaceList",
      componentId: "myne.spaces.workspace-list.default",
      adapter: "trusted-react",
      props: Object.freeze([]),
      events: Object.freeze({
        activate: Object.freeze(["spaces.openWorkspace"]),
        navigate: Object.freeze(["spaces.navigateToCraft"]),
        stop: Object.freeze(["spaces.stopDevServer"]),
        filter: Object.freeze(["spaces.filterWorkspaces"]),
        page: Object.freeze(["spaces.pageWorkspaces"]),
      }),
      forbidden: Object.freeze(["class", "className", "style"]),
      fallback: "enclosing-slot",
    }),
    spaces: Object.freeze({
      tag: "spaces",
      componentId: "myne.spaces.spaces.default",
      adapter: "trusted-react",
      props: Object.freeze([]),
      events: Object.freeze({ activate: Object.freeze(["spaces.navigateToCraft"]) }),
      forbidden: Object.freeze(["class", "className", "style"]),
      fallback: "enclosing-slot",
    }),
    spacePicker: Object.freeze({
      tag: "spacePicker",
      componentId: "myne.spaces.space-picker.default",
      adapter: "trusted-react",
      props: Object.freeze([]),
      events: Object.freeze({
        close: Object.freeze(["spaces.dismissPicker"]),
        retry: Object.freeze(["spaces.retryOpenWorkspace"]),
        select: Object.freeze(["spaces.selectSpaceForWorkspace"]),
      }),
      forbidden: Object.freeze(["class", "className", "style"]),
      fallback: "enclosing-slot",
    }),
  }),
});

function diagnostic(code: string, message: string): UICDiagnostic {
  return { code, message };
}

function attrs(source: string): Record<string, string> {
  return Object.fromEntries([...source.matchAll(/\s([A-Za-z_:][\w:.-]*)="([^"]*)"/g)].map((match) => [match[1]!, match[2]!]));
}

interface ParsedXmlNode {
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: ParsedXmlNode[];
  text: string;
}

function parseXmlLite(xml: string): { roots: ParsedXmlNode[]; diagnostics: UICDiagnostic[] } {
  const roots: ParsedXmlNode[] = [];
  const diagnostics: UICDiagnostic[] = [];
  const stack: ParsedXmlNode[] = [];
  const tokens = xml.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>|<([^>]+)>|([^<]+)/g);
  for (const token of tokens) {
    if (token[1] !== undefined) {
      const current = stack.at(-1);
      if (current) current.text += token[1];
      continue;
    }
    if (token[3] !== undefined) {
      const current = stack.at(-1);
      if (current) current.text += token[3];
      else if (token[3].trim()) diagnostics.push(diagnostic("uic/xml/single-root-required", "UIC XML must contain one root element."));
      continue;
    }

    const raw = token[2]!.trim();
    if (raw.startsWith("!--")) continue;
    if (raw.startsWith("?") || raw.startsWith("!")) {
      diagnostics.push(diagnostic("uic/xml/executable-forbidden", "UIC XML cannot contain declarations, doctypes, or processing instructions."));
      continue;
    }
    if (raw.startsWith("/")) {
      const name = raw.slice(1).trim();
      const open = stack.pop();
      if (!open || open.name !== name) diagnostics.push(diagnostic("uic/xml/malformed", `Mismatched closing tag "${name}".`));
      continue;
    }

    const selfClosing = raw.endsWith("/");
    const body = selfClosing ? raw.slice(0, -1).trim() : raw;
    const [name = "", ...rest] = body.split(/\s+/);
    const node: ParsedXmlNode = { name, attrs: attrs(` ${rest.join(" ")}`), children: [], text: "" };
    const parent = stack.at(-1);
    if (parent) parent.children.push(node);
    else roots.push(node);
    if (!selfClosing) stack.push(node);
  }
  if (stack.length) diagnostics.push(diagnostic("uic/xml/malformed", "UIC XML contains unclosed tags."));
  return { roots, diagnostics };
}

function parseProp(value: string): UICPropValue {
  const binding = value.match(/^\{(model\.[A-Za-z][\w.]*)\}$/);
  return binding ? { kind: "binding", path: binding[1]! } : { kind: "literal", value };
}

function requireComponent(descriptor: UICSurfaceDescriptor, tag: string): UICComponentDescriptor {
  const component = descriptor.components[tag];
  if (!component) throw new Error(`UIC descriptor missing component ${tag}`);
  return component;
}

function walkNodes(nodes: readonly ParsedXmlNode[], visit: (node: ParsedXmlNode, parent: ParsedXmlNode | undefined, depth: number) => void, parent?: ParsedXmlNode, depth = 1) {
  for (const node of nodes) {
    visit(node, parent, depth);
    walkNodes(node.children, visit, node, depth + 1);
  }
}

function descendantTags(root: ParsedXmlNode, names: readonly string[]): ParsedXmlNode[] {
  const wanted = new Set(names.map((name) => `uic:${name}`));
  const found: ParsedXmlNode[] = [];
  walkNodes(root.children, (node) => {
    if (wanted.has(node.name)) found.push(node);
  });
  return found;
}

function collectLayoutTreeSlotTags(nodes: readonly UICLayoutTreeNode[], tags: string[] = []): string[] {
  for (const node of nodes) {
    if (node.kind === "slot") tags.push(node.tag);
    else collectLayoutTreeSlotTags(node.children, tags);
  }
  return tags;
}

function rowTemplateNodes(root: ParsedXmlNode, sectionTag = "recentlyCreatedCraft"): ParsedXmlNode[] {
  const section = descendantTags(root, [sectionTag]).find((node) => node.name === `uic:${sectionTag}`);
  return section?.children.filter((child) => child.name === "uic:rowTemplate") ?? [];
}

function templateDepth(node: ParsedXmlNode, depth = 1): number {
  return Math.max(depth, ...node.children.map((child) => templateDepth(child, depth + 1)));
}

function templateNodeCount(node: ParsedXmlNode): number {
  return 1 + node.children.reduce((sum, child) => sum + templateNodeCount(child), 0);
}

function structuralAllowedAttrs(tag: string): ReadonlySet<string> | undefined {
  if (tag === "layout") return new Set(["variant", "name", "aria-label"]);
  if (tag === "region") return new Set(["name", "as", "aria-label"]);
  if (tag === "stack" || tag === "grid" || tag === "split" || tag === "card") return new Set(["name", "aria-label"]);
  return undefined;
}

function templateAllowedAttrs(tag: string): ReadonlySet<string> | undefined {
  if (tag === "rowTemplate") return new Set(["for"]);
  if (tag === "row") return new Set(["variant"]);
  if (tag === "text") return new Set(["bind", "tone"]);
  if (tag === "action") return new Set(["event", "label"]);
  return undefined;
}

function isUrlLike(value: string): boolean {
  return /(?:https?:|javascript:|data:)/iu.test(value);
}

export const UIC_SCOPED_CSS_BUDGET = Object.freeze({
  maxBytes: 4096,
  maxSelectors: 24,
  maxDeclarations: 80,
  maxSelectorLength: 160,
});

export type UICCompiledScopedCss = Readonly<{
  css: string;
  diagnostics: readonly UICDiagnostic[];
}>;

const UIC_ALLOWED_CSS_PROPERTIES = new Set([
  "align-items",
  "background",
  "background-color",
  "border",
  "border-color",
  "border-radius",
  "box-shadow",
  "color",
  "column-gap",
  "display",
  "gap",
  "grid-template-columns",
  "grid-template-rows",
  "justify-content",
  "min-height",
  "padding",
  "row-gap",
]);

const UIC_FORBIDDEN_CSS_PROPERTIES = new Set([
  "clip-path",
  "filter",
  "height",
  "inset",
  "left",
  "opacity",
  "pointer-events",
  "position",
  "right",
  "top",
  "transform",
  "visibility",
  "width",
  "z-index",
]);

function cssTextFromRoot(root: ParsedXmlNode): string {
  return root.children.find((child) => child.name === "uic:css")?.text.trim() ?? "";
}

function selectorDiagnostic(selector: string): UICDiagnostic | undefined {
  if (selector.length > UIC_SCOPED_CSS_BUDGET.maxSelectorLength) return diagnostic("uic/css/selector-budget", "UIC CSS selector exceeds the maximum supported length.");
  if (/(^|[\s>+~,])(?:html|body|:root|\*)(?:$|[\s>+~,#.:[)])/iu.test(selector)) return diagnostic("uic/css/global-selector", `UIC CSS selector "${selector}" cannot target global document roots.`);
  if (/\[data-uic-fallback-diagnostic\b|\[data-myne-surface\b|data-uic-disable-env/iu.test(selector)) return diagnostic("uic/css/protected-selector", `UIC CSS selector "${selector}" cannot target protected fallback or host UI.`);
  if (/[+~]|\.\.|:has\b|:not\b|:is\b|:where\b|::/u.test(selector)) return diagnostic("uic/css/selector-forbidden", `UIC CSS selector "${selector}" uses an unsupported combinator or pseudo selector.`);
  return undefined;
}

function compileUICSelector(selector: string, descriptor: UICSurfaceDescriptor, regionNames: ReadonlySet<string>, scopeAttrValue: string): { selector: string } | { diagnostic: UICDiagnostic } {
  const issue = selectorDiagnostic(selector);
  if (issue) return { diagnostic: issue };

  const regionMatch = selector.match(/^:uic-region\(([A-Za-z][\w-]*)\)$/u);
  if (regionMatch) {
    const regionName = regionMatch[1]!;
    if (!regionNames.has(regionName)) return { diagnostic: diagnostic("uic/css/unknown-selector", `UIC CSS region selector "${regionName}" is not declared by this layout.`) };
    return { selector: `[data-uic-artifact="${scopeAttrValue}"] [data-uic-region="${regionName}"]` };
  }

  const slotMatch = selector.match(/^:uic-slot\(([A-Za-z][\w-]*)\)$/u);
  if (slotMatch) {
    const slotName = slotMatch[1]!;
    if (!descriptor.layoutTags.includes(slotName)) return { diagnostic: diagnostic("uic/css/unknown-selector", `UIC CSS slot selector "${slotName}" is not declared by this surface.`) };
    return { selector: `[data-uic-artifact="${scopeAttrValue}"] [data-uic-slot="${slotName}"]` };
  }

  if (selector === ":uic-scope") return { selector: `[data-uic-artifact="${scopeAttrValue}"]` };
  return { diagnostic: diagnostic("uic/css/selector-forbidden", `UIC CSS selector "${selector}" is not in the safe selector allowlist.`) };
}

function validateUICCssDeclaration(property: string, value: string): UICDiagnostic | undefined {
  const prop = property.toLowerCase();
  if (!/^--(?:myne|uic)-[a-z0-9-]+$/u.test(prop) && (!UIC_ALLOWED_CSS_PROPERTIES.has(prop) || UIC_FORBIDDEN_CSS_PROPERTIES.has(prop))) {
    return diagnostic("uic/css/property-forbidden", `UIC CSS property "${property}" is not allowed.`);
  }
  if (/url\s*\(|@import|expression\s*\(|javascript:|data:/iu.test(value)) return diagnostic("uic/css/url-forbidden", `UIC CSS property "${property}" cannot reference URLs or executable values.`);
  if (/!important/iu.test(value)) return diagnostic("uic/css/value-forbidden", `UIC CSS property "${property}" cannot use !important.`);
  if (/\btransparent\b/iu.test(value)) return diagnostic("uic/css/value-forbidden", `UIC CSS property "${property}" cannot make inherited content transparent.`);
  if (prop === "display" && !/^(?:block|flex|grid|inline-flex)$/u.test(value.trim())) return diagnostic("uic/css/value-forbidden", "UIC CSS display values are limited to block, flex, grid, and inline-flex.");
  if (/\b(?:none|hidden)\b/iu.test(value) && /^(?:display|visibility|overflow|pointer-events)$/u.test(prop)) return diagnostic("uic/css/value-forbidden", `UIC CSS property "${property}" cannot hide or trap owned UI.`);
  if (/(?:^|\s)-\d/u.test(value) || /\b(?:100vw|100vh|9999px|999rem)\b/iu.test(value)) return diagnostic("uic/css/value-forbidden", `UIC CSS property "${property}" exceeds safe layout bounds.`);
  return undefined;
}

export function compileUICScopedCss(descriptor: UICSurfaceDescriptor, xml: string, scopeAttrValue: string): UICCompiledScopedCss {
  const parsed = parseXmlLite(xml);
  const diagnostics: UICDiagnostic[] = [...parsed.diagnostics];
  const root = parsed.roots[0];
  if (!root) return { css: "", diagnostics };
  const css = cssTextFromRoot(root);
  if (!css) return { css: "", diagnostics };
  if (!/^[A-Za-z0-9_.:-]+$/u.test(scopeAttrValue)) diagnostics.push(diagnostic("uic/css/scope", "UIC CSS scope identity is malformed."));
  if (new TextEncoder().encode(css).byteLength > UIC_SCOPED_CSS_BUDGET.maxBytes) diagnostics.push(diagnostic("uic/css/byte-budget", "UIC CSS exceeds the maximum supported byte length."));
  if (/@[A-Za-z-]+/u.test(css)) diagnostics.push(diagnostic("uic/css/at-rule-forbidden", "UIC CSS at-rules are not allowed in built-in layout CSS."));
  if (/url\s*\(|@import|expression\s*\(|javascript:|data:/iu.test(css)) diagnostics.push(diagnostic("uic/css/url-forbidden", "UIC CSS cannot reference URLs, imports, external assets, or executable values."));
  const sanitized = css.replace(/\/\*[\s\S]*?\*\//gu, "").trim();
  const regionNames = new Set<string>();
  walkNodes(root.children, (node) => {
    if (node.name === "uic:region" && node.attrs.name) regionNames.add(node.attrs.name);
  });
  const chunks: string[] = [];
  let cursor = 0;
  let selectorCount = 0;
  let declarationCount = 0;
  for (const match of sanitized.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    if (sanitized.slice(cursor, match.index).trim()) diagnostics.push(diagnostic("uic/css/malformed", "UIC CSS contains unsupported syntax outside a rule."));
    cursor = match.index + match[0].length;
    const rawSelectors = match[1]!.split(",").map((item) => item.trim()).filter(Boolean);
    const rawDeclarations = match[2]!.split(";").map((item) => item.trim()).filter(Boolean);
    selectorCount += rawSelectors.length;
    declarationCount += rawDeclarations.length;
    const selectors = rawSelectors.flatMap((selector) => {
      const compiled = compileUICSelector(selector, descriptor, regionNames, scopeAttrValue);
      if ("diagnostic" in compiled) {
        diagnostics.push(compiled.diagnostic);
        return [];
      }
      return [compiled.selector];
    });
    const declarations = rawDeclarations.flatMap((declaration) => {
      const separator = declaration.indexOf(":");
      if (separator <= 0) {
        diagnostics.push(diagnostic("uic/css/malformed", "UIC CSS declaration is malformed."));
        return [];
      }
      const property = declaration.slice(0, separator).trim();
      const value = declaration.slice(separator + 1).trim();
      const issue = validateUICCssDeclaration(property, value);
      if (issue) {
        diagnostics.push(issue);
        return [];
      }
      return [`${property}: ${value}`];
    });
    if (selectors.length && declarations.length) chunks.push(`${selectors.join(", ")} { ${declarations.join("; ")}; }`);
  }
  if (sanitized.slice(cursor).trim()) diagnostics.push(diagnostic("uic/css/malformed", "UIC CSS contains unsupported syntax outside a rule."));
  if (selectorCount > UIC_SCOPED_CSS_BUDGET.maxSelectors) diagnostics.push(diagnostic("uic/css/selector-budget", "UIC CSS exceeds the maximum supported selector count."));
  if (declarationCount > UIC_SCOPED_CSS_BUDGET.maxDeclarations) diagnostics.push(diagnostic("uic/css/declaration-budget", "UIC CSS exceeds the maximum supported declaration count."));
  return { css: diagnostics.length ? "" : chunks.join("\n"), diagnostics };
}

async function sha256(value: string): Promise<`sha256-${string}`> {
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return `sha256-${btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "")}`;
}

function stableDescriptorSource(descriptor: UICSurfaceDescriptor): string {
  return JSON.stringify({
    artifactVersion: descriptor.artifactVersion,
    components: Object.fromEntries(Object.entries(descriptor.components).sort(([a], [b]) => a.localeCompare(b))),
    layoutTags: descriptor.layoutTags,
    namespace: descriptor.namespace,
    rootTag: descriptor.rootTag,
    surface: descriptor.surface,
  });
}

export function generateUICXsd(descriptor: UICSurfaceDescriptor): string {
  const topLevel = descriptor.layoutTags.map((tag) => `        <xs:element ref="uic:${tag}" minOccurs="1" maxOccurs="1" />`).join("\n");
  const componentElements = descriptor.layoutTags.map((tag) => {
    const component = requireComponent(descriptor, tag);
    const eventAttrs = Object.entries(component.events ?? {}).map(([event, actions]) => `      <xs:attribute name="uic:on-${event}" type="xs:string" use="optional" fixed="${actions[0] ?? ""}" />`).join("\n");
    if (tag === "pageHeader") return `  <xs:element name="${component.tag}">
    <xs:complexType>
      <xs:sequence>
        <xs:element ref="uic:slot" minOccurs="0" maxOccurs="1" />
      </xs:sequence>
      <xs:attribute name="title" type="xs:string" use="optional" />
      <xs:attribute name="subtitle" type="xs:string" use="optional" />
    </xs:complexType>
  </xs:element>`;
    return `  <xs:element name="${component.tag}">
    <xs:complexType>
${eventAttrs}
    </xs:complexType>
  </xs:element>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:uic="${descriptor.namespace}" targetNamespace="${descriptor.namespace}" elementFormDefault="qualified">
  <xs:element name="${descriptor.rootTag}">
    <xs:complexType>
      <xs:sequence>
        <xs:element ref="uic:css" minOccurs="0" maxOccurs="1" />
${topLevel}
      </xs:sequence>
      <xs:attribute name="artifactVersion" type="xs:positiveInteger" use="required" fixed="1" />
      <xs:attribute name="uic:id" type="xs:string" use="optional" />
      <xs:attribute name="uic:label" type="xs:string" use="optional" />
      <xs:attribute name="uic:description" type="xs:string" use="optional" />
      <xs:attribute name="uic:default" type="xs:boolean" use="optional" />
      <xs:attribute name="uic:availability" type="xs:string" use="optional" />
      <xs:attribute name="uic:layout-kind" type="xs:string" use="optional" />
      <xs:attribute name="uic:order" type="xs:integer" use="optional" />
      <xs:attribute name="uic:slot-order" type="xs:string" use="optional" />
    </xs:complexType>
  </xs:element>
  <xs:element name="css" type="xs:string" />
  <xs:element name="slot">
    <xs:complexType>
      <xs:sequence>
        <xs:element ref="uic:pageHeaderAction" minOccurs="0" maxOccurs="8" />
      </xs:sequence>
      <xs:attribute name="name" use="required" fixed="actions" />
    </xs:complexType>
  </xs:element>
${componentElements}
  <xs:element name="${requireComponent(descriptor, "pageHeaderAction").tag}">
    <xs:complexType>
      <xs:attribute name="label" type="xs:string" use="required" />
    </xs:complexType>
  </xs:element>
</xs:schema>`;
}

export function validateUICXml(descriptor: UICSurfaceDescriptor, xml: string): { diagnostics: readonly UICDiagnostic[] } {
  const parsed = parseXmlLite(xml);
  const diagnostics: UICDiagnostic[] = [...parsed.diagnostics];
  if (/<\/?uic:component\b/.test(xml)) diagnostics.push(diagnostic("uic/xml/generic-component-forbidden", "UIC v1 uses generated named tags, not generic component refs."));
  if (/<\/?script\b|<\?xml-stylesheet|<!DOCTYPE/i.test(xml)) diagnostics.push(diagnostic("uic/xml/executable-forbidden", "UIC XML cannot contain executable markup."));
  if (/\s(?:class|className|style)=/.test(xml)) diagnostics.push(diagnostic("uic/xml/raw-style-forbidden", "UIC XML cannot pass raw class or style props."));

  const pageHeaderDescriptor = requireComponent(descriptor, "pageHeader");
  const pageHeaderAction = requireComponent(descriptor, "pageHeaderAction");
  const allowedTags = new Set([descriptor.rootTag, "css", "slot", pageHeaderAction.tag, ...descriptor.layoutTags, ...UIC_STRUCTURAL_TAGS, ...UIC_ROW_TEMPLATE_TAGS]);
  let nodeCount = 0;
  let totalNodeCount = 0;
  const regionNames = new Set<string>();

  function checkNode(node: ParsedXmlNode, parent?: ParsedXmlNode) {
    totalNodeCount += 1;
    if (!node.name.startsWith("uic:")) {
      diagnostics.push(diagnostic(node.name.includes(":") ? "uic/xml/unsupported-namespace" : "uic/xml/non-uic-element", `Unsupported element "${node.name}".`));
      return;
    }
    const tag = node.name.slice(4);
    if (!allowedTags.has(tag)) diagnostics.push(diagnostic("uic/xml/unknown-tag", `Unknown UIC tag "${tag}".`));

    const allowedAttrs = tag === descriptor.rootTag
      ? new Set(["xmlns:uic", "artifactVersion", "uic:id", "uic:label", "uic:description", "uic:default", "uic:availability", "uic:layout-kind", "uic:order", "uic:slot-order"])
      : tag === "slot"
        ? new Set(["name"])
      : structuralAllowedAttrs(tag)
        ? structuralAllowedAttrs(tag)!
        : templateAllowedAttrs(tag)
          ? templateAllowedAttrs(tag)!
          : descriptor.components[tag]
            ? new Set([...descriptor.components[tag]!.props, ...Object.keys(descriptor.components[tag]!.events ?? {}).map((event) => `uic:on-${event}`)])
              : new Set<string>();
    const forbidden = descriptor.components[tag]?.forbidden ?? [];
    for (const attr of Object.keys(node.attrs)) {
      if (attr === "version" && descriptor.components[tag]) diagnostics.push(diagnostic("uic/xml/component-version-forbidden", "App-local generated UIC component tags are unversioned."));
      if (forbidden.includes(attr)) diagnostics.push(diagnostic("uic/xml/forbidden-prop", `Prop "${attr}" is not allowed on uic:${tag}.`));
      if (!allowedAttrs.has(attr)) diagnostics.push(diagnostic("uic/xml/unknown-attribute", `Attribute "${attr}" is not declared for uic:${tag}.`));
      if (attr.startsWith("uic:on-")) {
        const event = attr.slice("uic:on-".length);
        const allowedActions = descriptor.components[tag]?.events?.[event] ?? [];
        if (!allowedActions.includes(node.attrs[attr]!)) diagnostics.push(diagnostic("uic/xml/unknown-action", `Action "${node.attrs[attr]}" is not declared for uic:${tag}.`));
      }
      if (attr !== "xmlns:uic" && isUrlLike(node.attrs[attr]!)) diagnostics.push(diagnostic("uic/xml/url-forbidden", `URL-like value is not allowed on uic:${tag}.`));
    }
    if (UIC_STRUCTURAL_TAG_SET.has(tag)) {
      nodeCount += 1;
      const allowedChildren = new Set([...UIC_STRUCTURAL_TAGS.map((childTag) => `uic:${childTag}`), ...descriptor.layoutTags.filter((slotTag) => slotTag !== "pageHeader" && slotTag !== "spacePicker").map((slotTag) => `uic:${slotTag}`)]);
      for (const child of node.children) {
        if (!allowedChildren.has(child.name)) diagnostics.push(diagnostic("uic/xml/unsupported-structure", `uic:${tag} contains unsupported child "${child.name}".`));
      }
      if (tag === "layout" && node.attrs.variant && !["stack", "command-center"].includes(node.attrs.variant)) diagnostics.push(diagnostic("uic/xml/unknown-attribute", "UIC layout variant is unsupported."));
      if (tag === "region") {
        const name = node.attrs.name;
        if (!name) diagnostics.push(diagnostic("uic/xml/region-name", "UIC region primitives require a name."));
        else if (regionNames.has(name)) diagnostics.push(diagnostic("uic/xml/duplicate-region", `UIC region "${name}" is declared more than once.`));
        else regionNames.add(name);
        if (node.attrs.as && !["div", "section", "aside"].includes(node.attrs.as)) diagnostics.push(diagnostic("uic/xml/unknown-attribute", "UIC region as must be div, section, or aside."));
        if ((node.attrs.as === "section" || node.attrs.as === "aside") && !node.attrs["aria-label"]) diagnostics.push(diagnostic("uic/xml/landmark-label", "UIC landmark regions require aria-label."));
      }
    }
    if (UIC_ROW_TEMPLATE_TAG_SET.has(tag)) {
      if (tag === "rowTemplate") {
        if (node.text.trim()) diagnostics.push(diagnostic("uic/xml/default-children-forbidden", "UIC row templates cannot contain default text."));
        if (parent?.name !== "uic:recentlyCreatedCraft") diagnostics.push(diagnostic("uic/xml/unsupported-structure", "UIC row templates are only supported inside uic:recentlyCreatedCraft for this slice."));
        if (node.attrs.for !== "item") diagnostics.push(diagnostic("uic/xml/invalid-binding", "UIC row templates must bind the item context exactly."));
        if (node.children.length !== 1 || node.children[0]?.name !== "uic:row") diagnostics.push(diagnostic("uic/xml/unsupported-structure", "UIC row templates must contain exactly one uic:row."));
        if (templateDepth(node) > UIC_ROW_TEMPLATE_MAX_DEPTH) diagnostics.push(diagnostic("uic/xml/template-depth-budget", "UIC row template exceeds the maximum supported depth."));
        if (templateNodeCount(node) > UIC_ROW_TEMPLATE_MAX_NODES) diagnostics.push(diagnostic("uic/xml/template-node-budget", "UIC row template exceeds the maximum supported node count."));
      }
      if (tag === "row") {
        if (node.text.trim()) diagnostics.push(diagnostic("uic/xml/default-children-forbidden", "UIC row template rows cannot contain default text."));
        if (parent?.name !== "uic:rowTemplate") diagnostics.push(diagnostic("uic/xml/unsupported-structure", "UIC row nodes are only supported inside uic:rowTemplate."));
        if (node.attrs.variant && node.attrs.variant !== "standard" && node.attrs.variant !== "featured") diagnostics.push(diagnostic("uic/xml/unknown-attribute", "UIC row variant is unsupported."));
        if (node.children.some((child) => child.name !== "uic:text" && child.name !== "uic:action")) diagnostics.push(diagnostic("uic/xml/unsupported-structure", "UIC rows may contain text and action nodes only."));
      }
      if (tag === "text") {
        if (parent?.name !== "uic:row") diagnostics.push(diagnostic("uic/xml/unsupported-structure", "UIC text nodes are only supported inside uic:row."));
        if (node.attrs.bind !== "item.label" && node.attrs.bind !== "item.meta") diagnostics.push(diagnostic("uic/xml/invalid-binding", "UIC text bind must be item.label or item.meta."));
        if (node.attrs.tone && node.attrs.tone !== "primary" && node.attrs.tone !== "secondary" && node.attrs.tone !== "muted") diagnostics.push(diagnostic("uic/xml/unknown-attribute", "UIC text tone is unsupported."));
        if (node.children.length || node.text.trim()) diagnostics.push(diagnostic("uic/xml/default-children-forbidden", "UIC text template nodes cannot contain children."));
      }
      if (tag === "action") {
        if (parent?.name !== "uic:row") diagnostics.push(diagnostic("uic/xml/unsupported-structure", "UIC action nodes are only supported inside uic:row."));
        if (node.attrs.event !== "activate") diagnostics.push(diagnostic("uic/xml/unknown-action", "UIC row template action must be activate."));
        if (node.attrs.label && (node.attrs.label.length > 48 || /[<>]/u.test(node.attrs.label))) diagnostics.push(diagnostic("uic/xml/invalid-binding", "UIC row template action label is invalid."));
        if (node.children.length || node.text.trim()) diagnostics.push(diagnostic("uic/xml/default-children-forbidden", "UIC action template nodes cannot contain children."));
      }
    }
    if (tag === descriptor.rootTag && node.attrs["xmlns:uic"] !== descriptor.namespace) diagnostics.push(diagnostic("uic/xml/namespace-mismatch", "UIC namespace is missing or unsupported."));
    if (tag === "css" && parent?.name !== `uic:${descriptor.rootTag}`) diagnostics.push(diagnostic("uic/xml/css-position", "UIC CSS is only allowed as a top-level root child."));
    node.children.forEach((child) => checkNode(child, node));
  }
  parsed.roots.forEach((root) => checkNode(root));

  let maxDepth = 0;
  walkNodes(parsed.roots, (_node, _parent, depth) => {
    maxDepth = Math.max(maxDepth, depth);
  });
  if (maxDepth > UIC_LAYOUT_MAX_DEPTH) diagnostics.push(diagnostic("uic/xml/depth-budget", "UIC structural layout exceeds the maximum supported depth."));
  if (nodeCount > UIC_LAYOUT_MAX_NODES || totalNodeCount > UIC_LAYOUT_MAX_NODES + descriptor.layoutTags.length + 4) diagnostics.push(diagnostic("uic/xml/node-budget", "UIC structural layout exceeds the maximum supported node count."));

  if (parsed.roots.length !== 1) diagnostics.push(diagnostic("uic/xml/single-root-required", "UIC XML must contain exactly one root element."));
  const root = parsed.roots[0];
  if (!root || root.name !== `uic:${descriptor.rootTag}`) {
    diagnostics.push(diagnostic("uic/xml/root-required", `UIC XML root must be uic:${descriptor.rootTag}.`));
    return { diagnostics };
  }
  diagnostics.push(...compileUICScopedCss(descriptor, xml, "uic-validation-scope").diagnostics);

  const rootTags = root.children.map((child) => child.name);
  const cssCount = rootTags.filter((name) => name === "uic:css").length;
  const pageHeaderChildren = root.children.filter((child) => child.name === "uic:pageHeader");
  const hasStructuralLayout = root.children.some((child) => child.name === "uic:layout");
  if (cssCount > 1) diagnostics.push(diagnostic("uic/xml/duplicate-node", "UIC proof allows at most one top-level css node."));
  if (pageHeaderChildren.length !== 1) diagnostics.push(diagnostic(pageHeaderChildren.length ? "uic/xml/duplicate-node" : "uic/xml/missing-required-node", "SpacesOverview UIC proof requires exactly one uic:pageHeader."));
  const layoutNodes = root.children.filter((child) => child.name === "uic:layout");
  const structuralTree = hasStructuralLayout ? getUICLayoutTreeUnchecked(descriptor, root) : [];
  const topLevelTags = hasStructuralLayout
    ? [
        ...root.children.filter((child) => child.name === "uic:pageHeader").map((child) => child.name.replace(/^uic:/, "")),
        ...collectLayoutTreeSlotTags(structuralTree),
        ...root.children.filter((child) => child.name === "uic:spacePicker").map((child) => child.name.replace(/^uic:/, "")),
      ]
    : rootTags.filter((name) => name !== "uic:css").map((name) => name.replace(/^uic:/, ""));
  if (!hasStructuralLayout && topLevelTags.join("\0") !== descriptor.layoutTags.join("\0")) diagnostics.push(diagnostic("uic/xml/slot-order", "SpacesOverview UIC layout tags must appear once in descriptor order."));
  if (hasStructuralLayout && layoutNodes.length !== 1) diagnostics.push(diagnostic(layoutNodes.length ? "uic/xml/duplicate-node" : "uic/xml/missing-required-node", "Structural SpacesOverview UIC layout requires exactly one uic:layout."));
  for (const tag of descriptor.layoutTags) {
    const count = topLevelTags.filter((candidate) => candidate === tag).length;
    if (count === 0) diagnostics.push(diagnostic("uic/xml/missing-required-node", `SpacesOverview UIC proof requires uic:${tag}.`));
    if (count > 1) diagnostics.push(diagnostic("uic/xml/duplicate-node", `SpacesOverview UIC proof allows one uic:${tag}.`));
  }
  const templates = rowTemplateNodes(root);
  if (templates.length > 1) diagnostics.push(diagnostic("uic/xml/duplicate-node", "UIC recentlyCreatedCraft supports at most one row template."));
  for (const tag of descriptor.layoutTags) {
    const componentNodes = descendantTags(root, [tag]);
    for (const componentNode of componentNodes) {
      if (tag === "recentlyCreatedCraft") {
        if (componentNode.text.trim()) diagnostics.push(diagnostic("uic/xml/default-children-forbidden", "UIC recentlyCreatedCraft cannot contain default text."));
        if (componentNode.children.some((child) => child.name !== "uic:rowTemplate")) diagnostics.push(diagnostic("uic/xml/unsupported-structure", "UIC recentlyCreatedCraft supports rowTemplate children only."));
      } else if (tag !== "pageHeader" && componentNode.children.length > 0) {
        diagnostics.push(diagnostic("uic/xml/unsupported-structure", `uic:${tag} does not support XML-authored children in this slice.`));
      }
    }
  }
  root.children.forEach((child, index) => {
    if (child.name === "uic:css" && index !== 0) diagnostics.push(diagnostic("uic/xml/css-position", "UIC CSS must be the first top-level child when present."));
    const allowedTopLevel = hasStructuralLayout
      ? ["uic:css", "uic:pageHeader", "uic:layout", "uic:spacePicker"]
      : ["uic:css", ...descriptor.layoutTags.map((tag) => `uic:${tag}`)];
    if (!allowedTopLevel.includes(child.name)) diagnostics.push(diagnostic("uic/xml/unsupported-structure", `Unsupported top-level element "${child.name}".`));
  });

  const pageHeader = pageHeaderChildren[0];
  if (pageHeader) {
    const slots = pageHeader.children.filter((child) => child.name === "uic:slot");
    if (pageHeader.text.trim() || pageHeader.children.some((child) => child.name !== "uic:slot")) diagnostics.push(diagnostic("uic/xml/default-children-forbidden", "UIC v1 allows named slots only."));
    if (slots.length > 1) diagnostics.push(diagnostic("uic/xml/duplicate-node", "UIC pageHeader proof allows at most one actions slot."));
    for (const slot of slots) {
      const name = slot.attrs.name;
      if (!name || !pageHeaderDescriptor.slots?.[name]) diagnostics.push(diagnostic("uic/xml/unknown-slot", `Unknown UIC slot "${name ?? ""}".`));
      if (slot.text.trim()) diagnostics.push(diagnostic("uic/xml/default-children-forbidden", "UIC slots may contain declared generated tags only."));
      const actions = slot.children.filter((child) => child.name === "uic:pageHeaderAction");
      if (actions.length > 1) diagnostics.push(diagnostic("uic/xml/duplicate-node", "UIC pageHeader proof allows at most one pageHeaderAction."));
      if (slot.children.some((child) => child.name !== "uic:pageHeaderAction")) diagnostics.push(diagnostic("uic/xml/unsupported-structure", "UIC slot contains an unsupported child."));
    }
  }
  return { diagnostics };
}

export function getUICValidatedActionBindings(descriptor: UICSurfaceDescriptor, xml: string): ReadonlyMap<string, Readonly<Record<string, string>>> {
  if (validateUICXml(descriptor, xml).diagnostics.length) return new Map();
  const root = parseXmlLite(xml).roots[0];
  if (!root) return new Map();
  const nodes: ParsedXmlNode[] = [];
  walkNodes(root.children, (node) => nodes.push(node));
  return new Map(nodes.flatMap((node) => {
    const tag = node.name.replace(/^uic:/, "");
    const component = descriptor.components[tag];
    if (!component?.events) return [];
    const actions = Object.fromEntries(Object.keys(component.events).flatMap((event) => {
      const value = node.attrs[`uic:on-${event}`];
      return value ? [[event, value]] : [];
    }));
    return Object.keys(actions).length ? [[tag, actions]] : [];
  }));
}

function toUICLayoutTreeNode(descriptor: UICSurfaceDescriptor, node: ParsedXmlNode): UICLayoutTreeNode | undefined {
  const tag = node.name.replace(/^uic:/, "");
  if (UIC_STRUCTURAL_TAG_SET.has(tag)) {
    return {
      kind: "primitive",
      tag: tag as UICLayoutPrimitiveTag,
      attrs: node.attrs,
      children: node.children.flatMap((child) => {
        const converted = toUICLayoutTreeNode(descriptor, child);
        return converted ? [converted] : [];
      }),
    };
  }
  if (descriptor.layoutTags.includes(tag) && tag !== "pageHeader" && tag !== "spacePicker") return { kind: "slot", tag };
  return undefined;
}

function getUICLayoutTreeUnchecked(descriptor: UICSurfaceDescriptor, root: ParsedXmlNode): readonly UICLayoutTreeNode[] {
  const layout = root.children.find((child) => child.name === "uic:layout");
  if (layout) {
    const converted = toUICLayoutTreeNode(descriptor, layout);
    return converted ? [converted] : [];
  }
  return descriptor.layoutTags
    .filter((tag) => tag !== "pageHeader" && tag !== "spacePicker")
    .map((tag) => ({ kind: "slot", tag }) satisfies UICLayoutTreeNode);
}

export function getUICLayoutTree(descriptor: UICSurfaceDescriptor, xml: string): readonly UICLayoutTreeNode[] {
  if (validateUICXml(descriptor, xml).diagnostics.length) return [];
  const root = parseXmlLite(xml).roots[0];
  if (!root) return [];
  return getUICLayoutTreeUnchecked(descriptor, root);
}

export function getUICCraftListRowTemplate(
  descriptor: UICSurfaceDescriptor,
  xml: string,
  sectionTag: "recentlyCreatedCraft",
): UICCraftListRowTemplate | undefined {
  if (validateUICXml(descriptor, xml).diagnostics.length) return undefined;
  const root = parseXmlLite(xml).roots[0];
  if (!root) return undefined;
  const template = rowTemplateNodes(root, sectionTag)[0];
  const row = template?.children[0];
  if (!template || !row || row.name !== "uic:row") return undefined;
  return {
    sectionTag,
    row: {
      variant: row.attrs.variant === "featured" ? "featured" : "standard",
      children: row.children.flatMap((child): UICCraftListRowTemplateChild[] => {
        if (child.name === "uic:text" && (child.attrs.bind === "item.label" || child.attrs.bind === "item.meta")) {
          const tone = child.attrs.tone === "secondary" || child.attrs.tone === "muted" ? child.attrs.tone : "primary";
          return [{ kind: "text" as const, bind: child.attrs.bind, tone }];
        }
        if (child.name === "uic:action" && child.attrs.event === "activate") {
          return [{ kind: "action" as const, event: "activate" as const, label: child.attrs.label ?? "Open craft" }];
        }
        return [];
      }),
    },
  };
}

export async function compileUICXml(
  descriptor: UICSurfaceDescriptor,
  xml: string,
): Promise<{ ok: true; ir: UICTemplateIR } | { ok: false; diagnostics: readonly UICDiagnostic[] }> {
  const diagnostics = validateUICXml(descriptor, xml).diagnostics;
  if (diagnostics.length) return { ok: false, diagnostics };

  const root = parseXmlLite(xml).roots[0]!;
  const css = cssTextFromRoot(root);
  const pageHeader = root.children.find((child) => child.name === "uic:pageHeader")!;
  const actionAttrs = pageHeader.children.find((child) => child.name === "uic:slot")?.children.find((child) => child.name === "uic:pageHeaderAction")?.attrs ?? {};
  const registryDigest = await sha256(stableDescriptorSource(descriptor));
  const schemaDigest = await sha256(generateUICXsd(descriptor));

  return {
    ok: true,
    ir: {
      artifactVersion: 1,
      surface: descriptor.surface,
      rootTag: descriptor.rootTag,
      namespace: descriptor.namespace,
      schemaDigest,
      registryDigest,
      css,
      nodes: [{
        tag: "pageHeader",
          componentId: requireComponent(descriptor, "pageHeader").componentId,
        adapter: "trusted-react",
        props: {
          title: parseProp(pageHeader.attrs.title ?? ""),
          subtitle: parseProp(pageHeader.attrs.subtitle ?? ""),
        },
        slots: {
          actions: actionAttrs.label ? [{
            tag: "pageHeaderAction",
            componentId: requireComponent(descriptor, "pageHeaderAction").componentId,
            adapter: "wrapper",
            props: { label: parseProp(actionAttrs.label) },
          }] : [],
        },
      }, ...descriptor.layoutTags.filter((tag) => tag !== "pageHeader").map((tag) => {
        const component = requireComponent(descriptor, tag);
        const node = descendantTags(root, [tag])[0];
        const actions = Object.fromEntries(Object.keys(component.events ?? {}).flatMap((event) => {
          const value = node?.attrs[`uic:on-${event}`];
          return value ? [[event, value]] : [];
        }));
        return { tag, componentId: component.componentId, adapter: component.adapter, props: {}, ...(Object.keys(actions).length ? { actions } : {}) };
      })],
    },
  };
}
