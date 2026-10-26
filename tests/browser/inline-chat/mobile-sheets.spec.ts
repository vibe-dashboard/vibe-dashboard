import { expect, test } from './backend';
import type { Locator, Page } from 'playwright/test';

async function expectSheet(page: Page) {
  const sheet = page.locator('[data-composer-sheet]').last();
  await expect(sheet).toBeVisible();
  await expect
    .poll(async () => {
      const box = await sheet.boundingBox();
      return (
        box && {
          x: Math.round(box.x),
          width: Math.round(box.width),
          bottom: Math.round(box.y + box.height),
        }
      );
    })
    .toEqual({
      x: 0,
      width: page.viewportSize()!.width,
      bottom: page.viewportSize()!.height,
    });
  expect((await sheet.boundingBox())!.y).toBeGreaterThanOrEqual(11);
  return sheet;
}

async function openAndDismiss(page: Page, trigger: Locator) {
  await trigger.click();
  await expectSheet(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-composer-sheet]')).toHaveCount(0);
  await expect(trigger).toBeFocused();
}

test('mobile Agent menus are bottom sheets and selections stay scoped to their session', async ({
  page,
  backend,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?right=workspace-2');
  const left = page.getByRole('region', { name: 'Left Agent' });
  const right = page.getByRole('region', { name: 'Right Agent' });
  const editor = left
    .getByRole('textbox', { name: /Follow up|Markdown editor/ })
    .last();
  await editor.fill('Keep this mobile draft');
  for (const name of [
    'Custom',
    'Model A',
    'Permissions',
    'session-1',
    'Workspace tasks',
    'Preview slots',
    'Context usage',
    'Go to previous message',
  ]) {
    await test.step(name, () =>
      openAndDismiss(page, left.getByRole('button', { name, exact: true }))
    );
    await expect(editor).toHaveText('Keep this mobile draft');
  }
  await openAndDismiss(page, left.getByRole('combobox', { name: 'Chat view' }));
  await left.getByRole('button', { name: 'Model A', exact: true }).click();
  await page.getByText('Model B', { exact: true }).click();
  await page.getByRole('button', { name: 'Low', exact: true }).click();
  await expectSheet(page);
  await page.getByRole('menuitem', { name: 'High', exact: true }).click();
  await page.keyboard.press('Escape');
  await left.getByRole('button', { name: 'Permissions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Plan', exact: true }).click();
  await expect(
    right.getByRole('button', { name: 'Model A', exact: true })
  ).toBeVisible();
  await expect(
    right.getByRole('textbox', { name: /Follow up|Markdown editor/ }).last()
  ).toBeEmpty();
  await left.getByRole('button', { name: 'Send', exact: true }).click();
  await expect
    .poll(
      () =>
        backend.requests.find(
          (request) => request.path === '/api/sessions/session-1/follow-up'
        )?.body
    )
    .toMatchObject({
      prompt: 'Keep this mobile draft',
      executor_config: {
        model_id: 'model-b',
        reasoning_id: 'high',
        permission_policy: 'PLAN',
      },
    });
});

test('mobile Create Workspace selectors preserve the draft and selected repository', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?create');
  await page.getByRole('button', { name: 'Recent', exact: true }).click();
  await page.getByText('repo', { exact: true }).click();
  await page.getByRole('option', { name: /main/ }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const create = page.getByTestId('inline-vk-create-workspace');
  const editor = create.getByRole('textbox', { name: 'Markdown editor' });
  await editor.fill('Keep the mobile creation draft');
  for (const name of ['Opencode', 'Custom', 'Model A', 'Permissions']) {
    await openAndDismiss(
      page,
      create.getByRole('button', { name, exact: true })
    );
  }
  await expect(editor).toHaveText('Keep the mobile creation draft');
  await expect(
    create.getByRole('button', { name: 'repo · main', exact: true })
  ).toBeVisible();
  await create.getByRole('button', { name: 'Model A', exact: true }).click();
  await page.locator('button[aria-label="Close"]').last().click();
  await expect(page.locator('[data-composer-sheet]')).toHaveCount(0);
  await expect(
    create.getByRole('button', { name: 'Model A', exact: true })
  ).toBeFocused();
});

test('mobile sheets follow the visible keyboard viewport and dismiss from the backdrop', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const left = page.getByRole('region', { name: 'Left Agent' });
  const trigger = left.getByRole('button', { name: 'Preview slots' });
  await trigger.click();
  const sheet = await expectSheet(page);
  await page.evaluate(() => {
    Object.defineProperties(window.visualViewport!, {
      height: { configurable: true, value: 320 },
      offsetTop: { configurable: true, value: 100 },
    });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect
    .poll(async () => {
      const box = await sheet.boundingBox();
      return box && box.y >= 111 && Math.abs(box.y + box.height - 420) < 2;
    })
    .toBe(true);
  await page.mouse.click(10, 50);
  await expect(sheet).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('short-screen task sheets scroll and nested session selection targets the chosen session', async ({
  page,
  backend,
}) => {
  backend.tasks.groups.open = Array.from({ length: 30 }, (_, index) => ({
    ...backend.tasks.groups.open[0]!,
    id: `task-${index}`,
    title: `Open task ${index}`,
  }));
  backend.tasks.counts.open = 30;
  await page.setViewportSize({ width: 700, height: 380 });
  await page.goto('/');
  const left = page.getByRole('region', { name: 'Left Agent' });
  await left.getByRole('button', { name: 'Workspace tasks' }).click();
  const sheet = await expectSheet(page);
  await expect(
    sheet.getByText('task-29 · Open task 29', { exact: true })
  ).toBeAttached();
  const sessions = sheet.getByRole('combobox', {
    name: 'Housekeeping session',
  });
  await sessions.click();
  await expectSheet(page);
  await page.getByRole('option', { name: 'session-2', exact: true }).click();
  await expect(sessions).toContainText('session-2');
  await sheet.getByRole('button', { name: 'Request housekeeping' }).click();
  await expect
    .poll(
      () =>
        backend.requests.find(
          (request) => request.path === '/api/sessions/session-2/follow-up'
        )?.body.prompt
    )
    .toBe("Please do housekeeping on this workspace's beads");
});

test('long model sheets remain searchable inside a reduced keyboard viewport', async ({
  page,
  backend,
}) => {
  backend.additionalModelCount = 30;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const left = page.getByRole('region', { name: 'Left Agent' });
  await left.getByRole('button', { name: 'Model A', exact: true }).click();
  const sheet = await expectSheet(page);
  const search = sheet.getByPlaceholder('Filter by provider, name or ID...');
  await expect(search).toBeVisible();
  await search.click();
  await page.evaluate(() => {
    Object.defineProperties(window.visualViewport!, {
      height: { configurable: true, value: 320 },
      offsetTop: { configurable: true, value: 0 },
    });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await search.fill('Extra model 25');
  const model = sheet.getByRole('button', {
    name: 'Extra model 25',
    exact: true,
  });
  await expect(model).toBeVisible();
  const box = (await model.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(320);
  await model.click();
  await page.keyboard.press('Escape');
  await expect(
    left.getByRole('button', { name: 'Extra model 25', exact: true })
  ).toBeVisible();
});

test('mobile slash suggestions use a bottom sheet while preserving editor focus and command insertion', async ({
  page,
  backend,
}) => {
  backend.slashCommands = [
    { name: 'review', description: 'Review the current changes' },
  ];
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const editor = page
    .getByRole('region', { name: 'Left Agent' })
    .getByRole('textbox', { name: /Follow up|Markdown editor/ })
    .last();
  await editor.pressSequentially('/re');
  const sheet = await expectSheet(page);
  await expect(editor).toBeFocused();
  await sheet.getByText('/review', { exact: true }).click();
  await expect(editor).toHaveText('/review');
  await expect(editor).toBeFocused();
});
