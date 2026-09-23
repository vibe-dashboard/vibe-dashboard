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
      events: Object.freeze({ stop: Object.freeze(["spaces.stopDevServer"]) }),
      forbidden: Object.freeze(["class", "className", "style"]),
      fallback: "enclosing-slot",
    }),
    recentlyVisitedCraft: Object.freeze({
      tag: "recentlyVisitedCraft",
      componentId: "myne.spaces.recently-visited.default",
      adapter: "trusted-react",
      props: Object.freeze([]),
      events: Object.freeze({ activate: Object.freeze(["spaces.navigateToCraft"]) }),
      forbidden: Object.freeze(["class", "className", "style"]),
      fallback: "enclosing-slot",
    }),
    recentlyCreatedCraft: Object.freeze({
      tag: "recentlyCreatedCraft",
      componentId: "myne.spaces.recently-created.default",
      adapter: "trusted-react",
      props: Object.freeze([]),
      events: Object.freeze({ activate: Object.freeze(["spaces.navigateToCraft"]) }),
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
  const allowedTags = new Set([descriptor.rootTag, "css", "slot", pageHeaderAction.tag, ...descriptor.layoutTags]);

  function checkNode(node: ParsedXmlNode, parent?: ParsedXmlNode) {
    if (!node.name.startsWith("uic:")) {
      diagnostics.push(diagnostic(node.name.includes(":") ? "uic/xml/unsupported-namespace" : "uic/xml/non-uic-element", `Unsupported element "${node.name}".`));
      return;
    }
    const tag = node.name.slice(4);
    if (!allowedTags.has(tag)) diagnostics.push(diagnostic("uic/xml/unknown-tag", `Unknown UIC tag "${tag}".`));

    const allowedAttrs = tag === descriptor.rootTag
      ? new Set(["xmlns:uic", "artifactVersion"])
      : tag === "slot"
        ? new Set(["name"])
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
    }
    if (tag === descriptor.rootTag && node.attrs["xmlns:uic"] !== descriptor.namespace) diagnostics.push(diagnostic("uic/xml/namespace-mismatch", "UIC namespace is missing or unsupported."));
    if (tag === "css" && parent?.name !== `uic:${descriptor.rootTag}`) diagnostics.push(diagnostic("uic/xml/css-position", "UIC CSS is only allowed as a top-level root child."));
    node.children.forEach((child) => checkNode(child, node));
  }
  parsed.roots.forEach((root) => checkNode(root));

  if (parsed.roots.length !== 1) diagnostics.push(diagnostic("uic/xml/single-root-required", "UIC XML must contain exactly one root element."));
  const root = parsed.roots[0];
  if (!root || root.name !== `uic:${descriptor.rootTag}`) {
    diagnostics.push(diagnostic("uic/xml/root-required", `UIC XML root must be uic:${descriptor.rootTag}.`));
    return { diagnostics };
  }

  const rootTags = root.children.map((child) => child.name);
  const cssCount = rootTags.filter((name) => name === "uic:css").length;
  const pageHeaderChildren = root.children.filter((child) => child.name === "uic:pageHeader");
  if (cssCount > 1) diagnostics.push(diagnostic("uic/xml/duplicate-node", "UIC proof allows at most one top-level css node."));
  if (pageHeaderChildren.length !== 1) diagnostics.push(diagnostic(pageHeaderChildren.length ? "uic/xml/duplicate-node" : "uic/xml/missing-required-node", "SpacesOverview UIC proof requires exactly one uic:pageHeader."));
  const topLevelTags = rootTags.filter((name) => name !== "uic:css").map((name) => name.replace(/^uic:/, ""));
  if (topLevelTags.join("\0") !== descriptor.layoutTags.join("\0")) diagnostics.push(diagnostic("uic/xml/slot-order", "SpacesOverview UIC layout tags must appear once in descriptor order."));
  for (const tag of descriptor.layoutTags) {
    const count = topLevelTags.filter((candidate) => candidate === tag).length;
    if (count === 0) diagnostics.push(diagnostic("uic/xml/missing-required-node", `SpacesOverview UIC proof requires uic:${tag}.`));
    if (count > 1) diagnostics.push(diagnostic("uic/xml/duplicate-node", `SpacesOverview UIC proof allows one uic:${tag}.`));
  }
  root.children.forEach((child, index) => {
    if (child.name === "uic:css" && index !== 0) diagnostics.push(diagnostic("uic/xml/css-position", "UIC CSS must be the first top-level child when present."));
    if (!["uic:css", ...descriptor.layoutTags.map((tag) => `uic:${tag}`)].includes(child.name)) diagnostics.push(diagnostic("uic/xml/unsupported-structure", `Unsupported top-level element "${child.name}".`));
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
  return new Map(root.children.flatMap((node) => {
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

export async function compileUICXml(
  descriptor: UICSurfaceDescriptor,
  xml: string,
): Promise<{ ok: true; ir: UICTemplateIR } | { ok: false; diagnostics: readonly UICDiagnostic[] }> {
  const diagnostics = validateUICXml(descriptor, xml).diagnostics;
  if (diagnostics.length) return { ok: false, diagnostics };

  const root = parseXmlLite(xml).roots[0]!;
  const css = root.children.find((child) => child.name === "uic:css")?.text.trim() ?? "";
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
        const node = root.children.find((child) => child.name === `uic:${tag}`);
        const actions = Object.fromEntries(Object.keys(component.events ?? {}).flatMap((event) => {
          const value = node?.attrs[`uic:on-${event}`];
          return value ? [[event, value]] : [];
        }));
        return { tag, componentId: component.componentId, adapter: component.adapter, props: {}, ...(Object.keys(actions).length ? { actions } : {}) };
      })],
    },
  };
}
