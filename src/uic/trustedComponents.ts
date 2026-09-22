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
  const diagnostics: UICDiagnostic[] = [];
  if (/<\/?uic:component\b/.test(xml)) diagnostics.push(diagnostic("uic/xml/generic-component-forbidden", "UIC v1 uses generated named tags, not generic component refs."));
  if (/<\/?script\b|<\?xml-stylesheet|<!DOCTYPE/i.test(xml)) diagnostics.push(diagnostic("uic/xml/executable-forbidden", "UIC XML cannot contain executable markup."));
  if (/\s(?:class|className|style)=/.test(xml)) diagnostics.push(diagnostic("uic/xml/raw-style-forbidden", "UIC XML cannot pass raw class or style props."));
  if (!xml.includes(`xmlns:uic="${descriptor.namespace}"`)) diagnostics.push(diagnostic("uic/xml/namespace-mismatch", "UIC namespace is missing or unsupported."));

  const allowedTags = new Set([descriptor.rootTag, "css", "slot", descriptor.components.pageHeader.tag, descriptor.components.pageHeaderAction.tag]);
  for (const match of xml.matchAll(/<\/?uic:([A-Za-z][\w.-]*)\b/g)) {
    if (!allowedTags.has(match[1]!)) diagnostics.push(diagnostic("uic/xml/unknown-tag", `Unknown UIC tag "${match[1]}".`));
  }

  for (const match of xml.matchAll(/<uic:(pageHeader|pageHeaderAction)\b([^>]*)/g)) {
    const tag = match[1]!;
    const component = descriptor.components[tag as "pageHeader" | "pageHeaderAction"];
    const attributes = attrs(match[2]!);
    if ("version" in attributes) diagnostics.push(diagnostic("uic/xml/component-version-forbidden", "App-local generated UIC component tags are unversioned."));
    for (const forbidden of component.forbidden) {
      if (forbidden in attributes) diagnostics.push(diagnostic("uic/xml/forbidden-prop", `Prop "${forbidden}" is not allowed on uic:${tag}.`));
    }
  }

  const pageHeader = xml.match(/<uic:pageHeader\b[^>]*>([\s\S]*?)<\/uic:pageHeader>/);
  if (!pageHeader) diagnostics.push(diagnostic("uic/xml/missing-required-node", "SpacesOverview UIC proof requires uic:pageHeader."));
  if (pageHeader) {
    const textOutsideSlots = pageHeader[1]!.replace(/<uic:slot\b[\s\S]*?<\/uic:slot>/g, "").trim();
    if (textOutsideSlots) diagnostics.push(diagnostic("uic/xml/default-children-forbidden", "UIC v1 allows named slots only."));
  }

  for (const match of xml.matchAll(/<uic:slot\b([^>]*)>/g)) {
    const name = attrs(match[1]!).name;
    if (!name || !descriptor.components.pageHeader.slots?.[name]) diagnostics.push(diagnostic("uic/xml/unknown-slot", `Unknown UIC slot "${name ?? ""}".`));
  }
  return { diagnostics };
}

export async function compileUICXml(
  descriptor: UICSurfaceDescriptor,
  xml: string,
): Promise<{ ok: true; ir: UICTemplateIR } | { ok: false; diagnostics: readonly UICDiagnostic[] }> {
  const diagnostics = validateUICXml(descriptor, xml).diagnostics;
  if (diagnostics.length) return { ok: false, diagnostics };

  const css = xml.match(/<uic:css><!\[CDATA\[([\s\S]*?)\]\]><\/uic:css>/)?.[1]?.trim() ?? "";
  const headerOpen = xml.match(/<uic:pageHeader\b([^>]*)>/)?.[1] ?? "";
  const headerAttrs = attrs(headerOpen);
  const actionOpen = xml.match(/<uic:pageHeaderAction\b([^>]*)\/>/)?.[1] ?? "";
  const actionAttrs = attrs(actionOpen);
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
          title: parseProp(headerAttrs.title ?? ""),
          subtitle: parseProp(headerAttrs.subtitle ?? ""),
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
