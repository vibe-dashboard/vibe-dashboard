import { timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import type { AppearanceActor } from "../theme/skins/appearanceRevisions";

export interface AppearanceMutationPrincipal {
  readonly channel: "browser" | "cli";
  readonly actor: AppearanceActor;
}

function credentialsMatch(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function createAppearanceMutationAuthenticator(options: {
  readonly browserOrigin: string;
  readonly cliToken?: string;
}): (context: Context) => AppearanceMutationPrincipal | undefined {
  const browserOrigin = new URL(options.browserOrigin).origin;
  return (context) => {
    const authorization = context.req.header("Authorization");
    if (authorization !== undefined) {
      const expected = options.cliToken;
      const prefix = "Bearer ";
      const candidate = authorization.startsWith(prefix) ? authorization.slice(prefix.length) : "";
      if (!expected || expected.length < 16 || !credentialsMatch(candidate, expected)) return undefined;
      return { channel: "cli", actor: { id: "local-cli", kind: "cli" } };
    }
    const origin = context.req.header("Origin");
    const fetchSite = context.req.header("Sec-Fetch-Site");
    if (origin !== browserOrigin || context.req.header("X-VK-Appearance-CSRF") !== "1"
      || (fetchSite !== undefined && fetchSite !== "same-origin")) return undefined;
    return { channel: "browser", actor: { id: "local-user", kind: "user" } };
  };
}
