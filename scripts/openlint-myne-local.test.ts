import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const checker = join(process.cwd(), "scripts/openlint-myne-local.mjs");

function diagnostics(fileName: string, source: string) {
  const root = mkdtempSync(join(tmpdir(), "myne-openlint-"));
  const file = join(root, fileName);
  writeFileSync(file, source);
  return JSON.parse(execFileSync(process.execPath, [checker, file], { encoding: "utf8" })) as Array<{ ruleId: string; message: string }>;
}

describe("myne OpenLint local policy", () => {
  it("accepts semantic markup, paired modifiers, sparse identities, and truthful native state", () => {
    expect(diagnostics("Good.view.tsx", '<button className="myne-button myne-button--accent" aria-pressed="true" data-myne-slot="library">Apply</button>')).toEqual([]);
  });

  it.each([
    ["Bad.tsx", "export const Bad = () => <div />", "intrinsic JSX"],
    ["Bad.view.tsx", "export function Bad(){ useThing(); return <div /> }", "hooks"],
    ["Bad.view.tsx", "export function Bad({appHooks}){ return <div /> }", "appHooks"],
    ["Bad.view.tsx", 'import x from "../../lib/vk-client"; export const x1=<div/>', "host import"],
    ["Bad.view.tsx", '<div data-vd-slot="x" />', "VD-era"],
    ["Bad.view.tsx", '<div style={{color:"red"}} />', "inline style"],
    ["Bad.view.tsx", '<div className="bg-red-500" />', "skin-controlled"],
    ["Bad.view.tsx", '<button className="myne-button--accent" />', "base class"],
    ["Bad.view.tsx", '<div data-myne-status="danger" />', "identity"],
    ["Bad.module.css", '.root :global(.myne-button) {}', "CSS Module"],
    ["Bad.view.tsx", '<div aria-pressed="true" />', "aria-pressed"],
    ["Bad.tsx", "export function Bad({appHooks}){ return null }", "approved container"],
    ["AppHooks.ts", 'import type { X } from "../components/private"; export interface AppHooksV1 {}', "public AppHooks"],
  ])("rejects %s: %s", (fileName, source, message) => {
    expect(diagnostics(fileName, source).some((item) => item.message.includes(message))).toBe(true);
  });

  it("allowlists explicit tests and historical documentation", () => {
    expect(diagnostics("negative.test.tsx", '<div data-vd-slot="negative" className="bg-red-500" />')).toEqual([]);
    expect(diagnostics("migration.md", "Historical data-vd-slot and --vd-color.")).toEqual([]);
  });
});
