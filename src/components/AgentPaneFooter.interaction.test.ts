// @vitest-environment jsdom
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentPaneFooter } from "./AgentPaneFooter";

vi.mock("@monaco-editor/react", () => ({
  default: ({ value, onChange, onMount, options }: any) => {
    React.useEffect(() => {
      onMount?.(
        { addAction: vi.fn() },
        { KeyMod: { CtrlCmd: 1 }, KeyCode: { Enter: 2 } },
      );
    }, [onMount]);
    return React.createElement("textarea", {
      "aria-label": options?.ariaLabel ?? "Follow-up message",
      value,
      readOnly: Boolean(options?.readOnly),
      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) =>
        onChange?.(event.target.value),
    });
  },
}));

type FetchCall = { url: string; method: string | undefined; body?: unknown };

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  readyState = 0;
  url: string;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.open());
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

function session(id = "session-1") {
  return {
    id,
    workspace_id: "workspace-1",
    executor: "CODEX" as const,
    created_at: "2026-09-14T00:00:00Z",
    updated_at: "2026-09-14T00:00:00Z",
  };
}

function renderFooter(selectedSessionId = "session-1") {
  return render(
    React.createElement(AgentPaneFooter, {
      workspaceId: "workspace-1",
      sessions: [session("session-1"), session("session-2")],
      selectedSessionId,
      loading: false,
      error: null,
      onSelect: vi.fn(),
      onRetry: vi.fn(),
      style: { left: 0, right: 0 },
    }),
  );
}

describe("AgentPaneFooter interactions", () => {
  let calls: FetchCall[];

  beforeEach(() => {
    calls = [];
    localStorage.clear();
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({
          url,
          method: init?.method,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        if (url.includes("/queue") && init?.method === "DELETE") {
          return Response.json({ success: true, data: { status: "empty" } });
        }
        if (url.includes("/queue") && init?.method === "POST") {
          return Response.json({
            success: true,
            data: {
              status: "queued",
              message: {
                session_id: "session-1",
                data: JSON.parse(String(init.body)),
                queued_at: "2026-09-14T00:00:00Z",
              },
            },
          });
        }
        if (url.includes("/queue")) {
          return Response.json({ success: true, data: { status: "empty" } });
        }
        if (url.includes("/scratch")) {
          return Response.json({ success: true, data: {} });
        }
        return Response.json({ success: true, data: {} });
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("sends when idle and queues while a selected-session execution is running", async () => {
    renderFooter();
    act(() => {
      FakeWebSocket.instances[0]?.emit({
        JsonPatch: [{ op: "replace", path: "/execution_processes", value: {} }],
      });
    });
    fireEvent.change(await screen.findByLabelText("Follow-up message"), {
      target: { value: "hello" },
    });
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Send" })
          .disabled,
      ).toBe(false),
    );
    expect(screen.queryByRole("button", { name: "Queue" })).toBeNull();

    act(() => {
      FakeWebSocket.instances[0]?.emit({
        JsonPatch: [
          {
            op: "replace",
            path: "/execution_processes",
            value: {
              p1: {
                id: "p1",
                session_id: "session-1",
                run_reason: "codingagent",
                status: "running",
                created_at: "2026-09-14T00:00:00Z",
              },
            },
          },
        ],
      });
      FakeWebSocket.instances[0]?.emit({ Ready: true });
    });

    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Queue" })
          .disabled,
      ).toBe(false),
    );
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Stop" }).disabled,
    ).toBe(false);
  });

  it("locks composer while queued and restores queued text plus config only after cancellation succeeds", async () => {
    vi.mocked(fetch).mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({
          url,
          method: init?.method,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        if (url.includes("/queue") && init?.method === "DELETE") {
          return Response.json({ success: true, data: { status: "empty" } });
        }
        if (url.includes("/queue")) {
          return Response.json({
            success: true,
            data: {
              status: "queued",
              message: {
                session_id: "session-1",
                queued_at: "2026-09-14T00:00:00Z",
                data: {
                  message: "queued text",
                  session_command: null,
                  executor_config: {
                    executor: "CODEX",
                    variant: "queued-variant",
                    model_id: "queued-model",
                    reasoning_id: "queued-reasoning",
                    permission_policy: "PLAN",
                  },
                },
              },
            },
          });
        }
        if (url.includes("/scratch"))
          return Response.json({ success: true, data: {} });
        return Response.json({ success: true, data: {} });
      },
    );

    renderFooter();
    const editor = (await screen.findByLabelText(
      "Follow-up message",
    )) as HTMLTextAreaElement;
    await waitFor(() => expect(editor.value).toBe(""));
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Cancel queue" })
          .disabled,
      ).toBe(false),
    );
    expect(editor.readOnly).toBe(true);
    expect(
      screen.getByLabelText<HTMLSelectElement>("Permission policy").disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Cancel queue" }));

    await waitFor(() => expect(editor.value).toBe("queued text"));
    expect(screen.getByLabelText<HTMLInputElement>("Variant").value).toBe(
      "queued-variant",
    );
    expect(screen.getByLabelText<HTMLInputElement>("Model").value).toBe(
      "queued-model",
    );
    expect(screen.getByLabelText<HTMLInputElement>("Reasoning").value).toBe(
      "queued-reasoning",
    );
    expect(
      screen.getByLabelText<HTMLSelectElement>("Permission policy").value,
    ).toBe("PLAN");
    expect(
      calls.some(
        (call) => call.url.includes("/queue") && call.method === "DELETE",
      ),
    ).toBe(true);
  });
});
