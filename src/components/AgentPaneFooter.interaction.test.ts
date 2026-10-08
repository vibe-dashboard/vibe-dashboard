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

const monacoActions = vi.hoisted(() => ({
  current: [] as Array<() => unknown>,
}));

vi.mock("@monaco-editor/react", () => ({
  default: ({ value, onChange, onMount, options }: any) => {
    React.useEffect(() => {
      onMount?.(
        {
          addAction: vi.fn((action) => {
            monacoActions.current.push(action.run);
            return { dispose: vi.fn() };
          }),
        },
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
      onSessionCreated: vi.fn(),
      onRetry: vi.fn(),
      style: { left: 0, right: 0 },
    }),
  );
}

function renderFooterWithProps(
  props: Partial<React.ComponentProps<typeof AgentPaneFooter>>,
) {
  return render(
    React.createElement(AgentPaneFooter, {
      workspaceId: "workspace-1",
      sessions: [session("session-1"), session("session-2")],
      selectedSessionId: "session-1",
      loading: false,
      error: null,
      onSelect: vi.fn(),
      onSessionCreated: vi.fn(),
      onRetry: vi.fn(),
      style: { left: 0, right: 0 },
      ...props,
    }),
  );
}

async function runShortcut() {
  await act(async () => {
    await monacoActions.current.at(-1)?.();
  });
}

describe("AgentPaneFooter interactions", () => {
  let calls: FetchCall[];

  beforeEach(() => {
    calls = [];
    localStorage.clear();
    FakeWebSocket.instances = [];
    monacoActions.current = [];
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
        if (url.endsWith("/sessions") && init?.method === "POST") {
          return Response.json({
            success: true,
            data: session("session-new"),
          });
        }
        return Response.json({ success: true, data: {} });
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("enables Send after the execution stream is ready with no running process", async () => {
    renderFooter();
    const editor = await screen.findByLabelText("Follow-up message");
    fireEvent.change(editor, { target: { value: "hello" } });

    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Send" })
        .disabled,
    ).toBe(true);

    act(() => {
      FakeWebSocket.instances[0]?.emit({ Ready: true });
    });

    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Send" })
          .disabled,
      ).toBe(false),
    );
  });

  it("does not poll queue while execution state is loading and nothing is queued", async () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    renderFooter();

    await waitFor(() =>
      expect(calls.filter((call) => call.url.includes("/queue"))).toHaveLength(
        1,
      ),
    );

    expect(
      setIntervalSpy.mock.calls.some(([, delay]) => delay === 1_500),
    ).toBe(false);
  });

  it("starts a new session from the chat footer without exposing executor switching", async () => {
    const onSessionCreated = vi.fn();
    const onSelect = vi.fn();
    renderFooterWithProps({ onSessionCreated, onSelect });

    expect(screen.queryByLabelText("Executor")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    fireEvent.change(await screen.findByLabelText("Follow-up message"), {
      target: { value: "fresh start" },
    });

    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Send" })
          .disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(onSessionCreated).toHaveBeenCalled());
    expect(onSelect).toHaveBeenCalledWith("session-new");
    expect(
      calls.some((call) => call.url.endsWith("/sessions") && call.method === "POST"),
    ).toBe(true);
    expect(
      calls.some(
        (call) =>
          call.url.includes("/sessions/session-new/follow-up") &&
          call.method === "POST",
      ),
    ).toBe(true);
  });

  it("enables Send after typing even if model discovery is still streaming", async () => {
    renderFooter();
    const editor = await screen.findByLabelText("Follow-up message");
    act(() => {
      FakeWebSocket.instances.find((socket) =>
        socket.url.includes("/execution-processes/"),
      )?.emit({ Ready: true });
      FakeWebSocket.instances.find((socket) =>
        socket.url.includes("/agents/discovered-options/"),
      )?.emit({
        JsonPatch: [
          {
            op: "replace",
            path: "/options/model_selector",
            value: {
              providers: [],
              models: [],
              model_order: [],
              default_model: null,
              agents: [],
              permissions: [],
            },
          },
        ],
      });
    });
    fireEvent.change(editor, { target: { value: "hello after model patch" } });

    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Send" })
          .disabled,
      ).toBe(false),
    );
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

  it("uses the same gates for Ctrl/Cmd+Enter as the action buttons", async () => {
    renderFooter();
    const editor = await screen.findByLabelText("Follow-up message");
    fireEvent.change(editor, { target: { value: "hello" } });

    await runShortcut();
    expect(
      calls.some(
        (call) =>
          call.url.includes("/follow-up") && call.method === "POST",
      ),
    ).toBe(false);

    act(() => {
      FakeWebSocket.instances[0]?.emit({
        JsonPatch: [{ op: "replace", path: "/execution_processes", value: {} }],
      });
    });
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Send" })
          .disabled,
      ).toBe(false),
    );
    await runShortcut();
    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.url.includes("/follow-up") && call.method === "POST",
        ),
      ).toBe(true),
    );

    calls = [];
    fireEvent.change(editor, { target: { value: "queued hello" } });
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
              },
            },
          },
        ],
      });
    });
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Queue" })
          .disabled,
      ).toBe(false),
    );
    await runShortcut();
    await waitFor(() =>
      expect(
        calls.some(
          (call) => call.url.includes("/queue") && call.method === "POST",
        ),
      ).toBe(true),
    );
  });

  it("does not run the Ctrl/Cmd+Enter shortcut while disabled by a route error", async () => {
    renderFooterWithProps({ error: "Could not load sessions" });
    fireEvent.change(await screen.findByLabelText("Follow-up message"), {
      target: { value: "hello" },
    });
    act(() => {
      FakeWebSocket.instances[0]?.emit({
        JsonPatch: [{ op: "replace", path: "/execution_processes", value: {} }],
      });
    });

    await runShortcut();

    expect(
      calls.some(
        (call) =>
          (call.url.includes("/follow-up") || call.url.includes("/queue")) &&
          call.method === "POST",
      ),
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
    expect(screen.getByLabelText<HTMLSelectElement>("Variant").value).toBe(
      "queued-variant",
    );
    expect(screen.getByLabelText<HTMLSelectElement>("Model").value).toBe(
      "queued-model",
    );
    expect(screen.getByLabelText<HTMLSelectElement>("Reasoning").value).toBe(
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
