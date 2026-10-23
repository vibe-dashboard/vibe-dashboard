import { parse } from "tldts";

export interface PreviewUrlParts {
  previewSlotId: string;
  workspaceToken: string;
  repoSlug: string;
  slotSlug: string;
}

export function buildPreviewSlotUrl(
  parts: PreviewUrlParts,
  siteOrigin: string | undefined,
) {
  if (!siteOrigin)
    throw new Error("Preview URLs require SITE_ORIGIN on the server");
  const origin = new URL(siteOrigin);
  if (!["http:", "https:"].includes(origin.protocol)) {
    throw new Error("SITE_ORIGIN must use HTTP or HTTPS");
  }
  if (
    !/^[a-f0-9]{16}$/.test(parts.workspaceToken) ||
    !/^[a-z0-9]{1,18}$/.test(parts.repoSlug) ||
    !/^[a-z0-9]{1,10}$/.test(parts.slotSlug)
  ) {
    throw new Error("Invalid preview URL parts");
  }
  const domain = parse(origin.hostname);
  if (domain.isIp)
    throw new Error("Preview URLs require a DNS hostname in SITE_ORIGIN");
  const prefix = `${parts.workspaceToken}-${parts.repoSlug}-${parts.slotSlug}`;
  const [siteLabel, ...siteDomain] = origin.hostname.split(".");
  const host = domain.subdomain
    ? `${prefix}-${siteLabel}-user.${siteDomain.join(".")}`
    : `${prefix}-user.${origin.hostname}`;
  if (host.split(".")[0]!.length > 63)
    throw new Error("Preview hostname exceeds the DNS label limit");
  origin.hostname = host;
  origin.pathname = "/";
  origin.search = "";
  origin.hash = "";
  origin.username = "";
  origin.password = "";
  return { ...parts, host: origin.host, url: origin.toString() };
}
