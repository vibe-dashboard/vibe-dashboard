import { beforeEach, describe, expect, it } from "vitest";
import {
  readSurfaceChatViewMode,
  readSurfaceSessionId,
  surfaceSessionStorageKey,
  writeSurfaceChatViewMode,
  writeSurfaceSessionId,
} from "../../vibe-kanban/packages/inline-chat/src/surfaceSessionState";

describe("surface session persistence", () => {
  let storage: Storage;

  beforeEach(() => {
    const values = new Map<string, string>();
    storage = {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      getItem: (key) => values.get(key) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      removeItem: (key) => values.delete(key),
      setItem: (key, value) => values.set(key, value),
    };
  });

  it("isolates selected sessions by workspace and surface", () => {
    writeSurfaceSessionId(storage, "workspace-a", "left", "session-1");
    writeSurfaceSessionId(storage, "workspace-a", "right", "session-2");

    expect(readSurfaceSessionId(storage, "workspace-a", "left")).toBe(
      "session-1",
    );
    expect(readSurfaceSessionId(storage, "workspace-a", "right")).toBe(
      "session-2",
    );
    expect(
      readSurfaceSessionId(storage, "workspace-b", "left"),
    ).toBeNull();
  });

  it("does not throw when browser storage is unavailable", () => {
    const unavailableStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;

    expect(
      readSurfaceSessionId(unavailableStorage, "workspace", "surface"),
    ).toBeNull();
    expect(() =>
      writeSurfaceSessionId(
        unavailableStorage,
        "workspace",
        "surface",
        "session",
      ),
    ).not.toThrow();
  });

  it("uses an encoded, versioned key", () => {
    expect(surfaceSessionStorageKey("workspace/a", "group:agent")).toBe(
      "vd:inline-vk-chat:v1:workspace%2Fa:group%3Aagent:selected-session",
    );
  });

  it("persists a valid chat view mode per surface", () => {
    writeSurfaceChatViewMode(storage, "workspace-a", "left", "zen");
    writeSurfaceChatViewMode(storage, "workspace-a", "right", "full");

    expect(readSurfaceChatViewMode(storage, "workspace-a", "left")).toBe(
      "zen",
    );
    expect(readSurfaceChatViewMode(storage, "workspace-a", "right")).toBe(
      "full",
    );
  });

  it("ignores an invalid stored chat view mode", () => {
    storage.setItem(
      "vd:inline-vk-chat:v1:workspace:surface:chat-view-mode",
      "invalid-mode",
    );
    expect(
      readSurfaceChatViewMode(storage, "workspace", "surface"),
    ).toBeNull();
  });
});
