import { describe, expect, it } from "vitest";
import type { WorkspaceRunConfigsResponse } from "../server/vk-client";
import { enabledPreviewSlots } from "./WorkspacePreviewMenu";

describe("WorkspacePreviewMenu", () => {
  it("offers enabled slots from every repository", () => {
    const data = {
      run_configs: [],
      preview_url_parts: [],
      preview_slots: [
        { id: "a", repo_id: "repo-a", enabled: true },
        { id: "b", repo_id: "repo-b", enabled: false },
        { id: "c", repo_id: "repo-c", enabled: true },
      ],
    } as unknown as WorkspaceRunConfigsResponse;

    expect(enabledPreviewSlots(data).map((slot) => slot.id)).toEqual([
      "a",
      "c",
    ]);
  });
});
