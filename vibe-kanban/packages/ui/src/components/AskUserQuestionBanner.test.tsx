// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AskUserQuestionBanner } from "./AskUserQuestionBanner";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("AskUserQuestionBanner", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps the final answer retryable when submission fails", async () => {
    const onSubmitAnswers = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(undefined);

    await act(async () => {
      root.render(
        <AskUserQuestionBanner
          questions={[
            {
              header: "Decision",
              question: "Proceed?",
              multiSelect: false,
              options: [{ label: "Yes", description: "Continue" }],
            },
          ]}
          onSubmitAnswers={onSubmitAnswers}
          isSubmitting={false}
          isTimedOut={false}
          error="network"
        />,
      );
    });

    const yesButton = () =>
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Yes",
      ) as HTMLButtonElement;

    await act(async () => {
      yesButton().click();
    });

    expect(onSubmitAnswers).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Proceed?");
    expect(container.textContent).toContain("network");

    await act(async () => {
      yesButton().click();
    });

    expect(onSubmitAnswers).toHaveBeenCalledTimes(2);
  });

  it("does not treat a duplicate final submit as success when the in-flight request fails", async () => {
    const first = deferred<void>();
    const onSubmitAnswers = vi.fn().mockReturnValueOnce(first.promise);

    await act(async () => {
      root.render(
        <AskUserQuestionBanner
          questions={[
            {
              header: "Decision",
              question: "Proceed?",
              multiSelect: false,
              options: [{ label: "Yes", description: "Continue" }],
            },
          ]}
          onSubmitAnswers={onSubmitAnswers}
          isSubmitting={false}
          isTimedOut={false}
          error={null}
        />,
      );
    });

    const yesButton = () =>
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Yes",
      ) as HTMLButtonElement;

    await act(async () => {
      yesButton().click();
      yesButton().click();
    });

    expect(onSubmitAnswers).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.reject(new Error("network"));
      await first.promise.catch(() => undefined);
    });

    expect(container.textContent).toContain("Proceed?");
    expect(container.textContent).toContain("Yes");
  });
});
