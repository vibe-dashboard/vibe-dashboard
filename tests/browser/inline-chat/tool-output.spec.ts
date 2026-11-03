import { expect, test } from "./backend";

test("command and grouped search output expands below its row and stays pane-local", async ({
  page,
  backend,
}) => {
  backend.stream("session-1", "Inspecting tools");
  backend.append(
    "session-1",
    backend.entry("Command result", {
      type: "tool_use",
      tool_name: "Bash",
      status: { status: "success" },
      action_type: {
        action: "command_run",
        command: "npm run example",
        category: "other",
        result: {
          output: "COMMAND_OUTPUT_MARKER",
          exit_status: { type: "exit_code", code: 0 },
        },
      },
    }),
  );
  for (const query of ["first-query", "second-query"]) {
    backend.append(
      "session-1",
      backend.entry(`RESULT_${query}`, {
        type: "tool_use",
        tool_name: "Grep",
        status: { status: "success" },
        action_type: { action: "search", query },
      }),
    );
  }
  await page.goto("/");
  const left = page.getByRole("region", { name: "Left Agent", exact: true });
  const right = page.getByRole("region", { name: "Right Agent", exact: true });
  await expect(
    right.getByRole("button", { name: "npm run example", exact: true }),
  ).toBeVisible();
  const command = left.getByRole("button", {
    name: "npm run example",
    exact: true,
  });
  await command.click();
  const output = left.getByRole("region", { name: "Bash output", exact: true });
  await expect(output).toHaveText("COMMAND_OUTPUT_MARKER");
  await expect(
    right.getByRole("region", { name: "Bash output", exact: true }),
  ).toHaveCount(0);
  const rowBox = await command.boundingBox();
  const outputBox = await output.boundingBox();
  expect(outputBox!.y).toBeGreaterThanOrEqual(rowBox!.y + rowBox!.height);
  await left.getByRole("button", { name: /Search · 2/ }).click();
  await left.getByRole("button", { name: "first-query", exact: true }).click();
  await expect(
    left.getByRole("region", { name: "Grep output", exact: true }),
  ).toHaveText("RESULT_first-query");
  const firstOutput = await left
    .getByRole("region", { name: "Grep output", exact: true })
    .boundingBox();
  const secondRow = await left
    .getByRole("button", { name: "second-query", exact: true })
    .boundingBox();
  expect(firstOutput!.y + firstOutput!.height).toBeLessThanOrEqual(
    secondRow!.y,
  );
  await command.focus();
  await page.keyboard.press("Enter");
  await expect(output).toHaveCount(0);
});
