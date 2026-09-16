import type { Meta, StoryObj } from "@storybook/react-vite";
import { createFakeAppHooksV1 } from "../app-hooks/AppHooks";
import { createDefaultAppearanceSnapshot } from "../theme/skins/defaultAppearanceSnapshot";
import { AppearanceSettings } from "./AppearanceSettings";

const canonical = createDefaultAppearanceSnapshot("2026-09-16T00:00:00Z");
const snapshot = { schemaVersion: 1 as const, value: JSON.parse(canonical).skin };
const history = { head: { revisionId: "myne-rev-story", snapshot: canonical, summary: "Myne Default Dark", committedAt: "2026-09-16T00:00:00Z", source: "user" }, revisions: [{ revisionId: "myne-rev-story", snapshot: canonical, summary: "Myne Default Dark", committedAt: "2026-09-16T00:00:00Z", source: "user" }] };
const okFetch: typeof fetch = async () => new Response(JSON.stringify(history), { status: 200, headers: { "Content-Type": "application/json" } });

const meta = {
  title: "Scenes/AppearanceSettings",
  component: AppearanceSettings,
  parameters: { layout: "fullscreen" },
  args: { appHooks: createFakeAppHooksV1({ appearanceSnapshot: snapshot }), fetcher: okFetch },
} satisfies Meta<typeof AppearanceSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {};
export const Mobile: Story = { parameters: { viewport: { defaultViewport: "mobile1" } } };
export const SafeModeRecovery: Story = {
  args: {
    appHooks: createFakeAppHooksV1({ appearanceState: { snapshot, loading: false, safeMode: true, error: "Persisted package failed validation; last-known-good appearance is active." } }),
    fetcher: async () => new Response(JSON.stringify({ error: "corrupt-history" }), { status: 503 }),
  },
};
