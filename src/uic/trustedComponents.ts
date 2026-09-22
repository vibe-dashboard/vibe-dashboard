export const UIC_XML_NAMESPACE_V1 = "https://vibedashboard.dev/uic/xml/v1";

export type UICAdapterKind = "trusted-react" | "wrapper";

export interface UICComponentDescriptor {
  readonly tag: string;
  readonly componentId: string;
  readonly adapter: UICAdapterKind;
  readonly props: readonly string[];
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
  readonly components: Readonly<{
    pageHeader: UICComponentDescriptor;
    pageHeaderAction: UICComponentDescriptor;
  }>;
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

async function sha256(value: string): Promise<`sha256-${string}`> {
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return `sha256-${btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "")}`;
}

function stableDescriptorSource(descriptor: UICSurfaceDescriptor): string {
  return JSON.stringify({
    artifactVersion: descriptor.artifactVersion,
    components: Object.fromEntries(Object.entries(descriptor.components).sort(([a], [b]) => a.localeCompare(b))),
    namespace: descriptor.namespace,
    rootTag: descriptor.rootTag,
    surface: descriptor.surface,
  });
}

export function generateUICXsd(descriptor: UICSurfaceDescriptor): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:uic="${descriptor.namespace}" targetNamespace="${descriptor.namespace}" elementFormDefault="qualified">
  <xs:element name="${descriptor.rootTag}">
    <xs:complexType>
      <xs:sequence>
        <xs:element ref="uic:css" minOccurs="0" maxOccurs="1" />
        <xs:element ref="uic:pageHeader" minOccurs="1" maxOccurs="1" />
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
  <xs:element name="${descriptor.components.pageHeader.tag}">
    <xs:complexType>
      <xs:sequence>
        <xs:element ref="uic:slot" minOccurs="0" maxOccurs="1" />
      </xs:sequence>
      <xs:attribute name="title" type="xs:string" use="optional" />
      <xs:attribute name="subtitle" type="xs:string" use="optional" />
    </xs:complexType>
  </xs:element>
  <xs:element name="${descriptor.components.pageHeaderAction.tag}">
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

  const allowedTags = new Set([descriptor.rootTag, "css", "slot", descriptor.components.pageHeader.tag, descriptor.components.pageHeaderAction.tag]);

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
        : tag === descriptor.components.pageHeader.tag
          ? new Set(descriptor.components.pageHeader.props)
          : tag === descriptor.components.pageHeaderAction.tag
            ? new Set(descriptor.components.pageHeaderAction.props)
            : new Set<string>();
    const forbidden = tag === descriptor.components.pageHeader.tag
      ? descriptor.components.pageHeader.forbidden
      : tag === descriptor.components.pageHeaderAction.tag
        ? descriptor.components.pageHeaderAction.forbidden
        : [];
    for (const attr of Object.keys(node.attrs)) {
      if (attr === "version" && (tag === descriptor.components.pageHeader.tag || tag === descriptor.components.pageHeaderAction.tag)) diagnostics.push(diagnostic("uic/xml/component-version-forbidden", "App-local generated UIC component tags are unversioned."));
      if (forbidden.includes(attr)) diagnostics.push(diagnostic("uic/xml/forbidden-prop", `Prop "${attr}" is not allowed on uic:${tag}.`));
      if (!allowedAttrs.has(attr)) diagnostics.push(diagnostic("uic/xml/unknown-attribute", `Attribute "${attr}" is not declared for uic:${tag}.`));
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
  root.children.forEach((child, index) => {
    if (child.name === "uic:css" && index !== 0) diagnostics.push(diagnostic("uic/xml/css-position", "UIC CSS must be the first top-level child when present."));
    if (!["uic:css", "uic:pageHeader"].includes(child.name)) diagnostics.push(diagnostic("uic/xml/unsupported-structure", `Unsupported top-level element "${child.name}".`));
  });

  const pageHeader = pageHeaderChildren[0];
  if (pageHeader) {
    const slots = pageHeader.children.filter((child) => child.name === "uic:slot");
    if (pageHeader.text.trim() || pageHeader.children.some((child) => child.name !== "uic:slot")) diagnostics.push(diagnostic("uic/xml/default-children-forbidden", "UIC v1 allows named slots only."));
    if (slots.length > 1) diagnostics.push(diagnostic("uic/xml/duplicate-node", "UIC pageHeader proof allows at most one actions slot."));
    for (const slot of slots) {
      const name = slot.attrs.name;
      if (!name || !descriptor.components.pageHeader.slots?.[name]) diagnostics.push(diagnostic("uic/xml/unknown-slot", `Unknown UIC slot "${name ?? ""}".`));
      if (slot.text.trim()) diagnostics.push(diagnostic("uic/xml/default-children-forbidden", "UIC slots may contain declared generated tags only."));
      const actions = slot.children.filter((child) => child.name === "uic:pageHeaderAction");
      if (actions.length > 1) diagnostics.push(diagnostic("uic/xml/duplicate-node", "UIC pageHeader proof allows at most one pageHeaderAction."));
      if (slot.children.some((child) => child.name !== "uic:pageHeaderAction")) diagnostics.push(diagnostic("uic/xml/unsupported-structure", "UIC slot contains an unsupported child."));
    }
  }
  return { diagnostics };
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
        componentId: descriptor.components.pageHeader.componentId,
        adapter: "trusted-react",
        props: {
          title: parseProp(pageHeader.attrs.title ?? ""),
          subtitle: parseProp(pageHeader.attrs.subtitle ?? ""),
        },
        slots: {
          actions: actionAttrs.label ? [{
            tag: "pageHeaderAction",
            componentId: descriptor.components.pageHeaderAction.componentId,
            adapter: "wrapper",
            props: { label: parseProp(actionAttrs.label) },
          }] : [],
        },
      }],
    },
  };
}
