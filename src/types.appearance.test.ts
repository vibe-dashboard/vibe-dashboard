import { describe, expect, it } from "vitest";
import { createDefaultWorkspace, ensureAppearanceSettingsEntry } from "./types";

describe("Appearance settings workspace migration", () => {
  it("ships and idempotently restores the protected production entry", () => {
    const current = createDefaultWorkspace();
    expect(current.tabGroups[0]?.tabs.map((tab) => tab.url)).toContain("internal://appearance");
    const old = { ...current, tabGroups: current.tabGroups.map((group) => ({ ...group, tabs: group.tabs.filter((tab) => tab.url !== "internal://appearance") })) };
    const migrated = ensureAppearanceSettingsEntry(old);
    expect(migrated.tabGroups[0]?.tabs.filter((tab) => tab.url === "internal://appearance")).toHaveLength(1);
    expect(ensureAppearanceSettingsEntry(migrated)).toBe(migrated);
  });
});
