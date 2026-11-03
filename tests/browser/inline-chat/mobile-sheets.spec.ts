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
  const count = await page.locator('[data-composer-sheet]').count();
  await trigger.click();
  await expectSheet(page);
  await expect(page.locator('[data-composer-sheet]')).toHaveCount(count + 1);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-composer-sheet]')).toHaveCount(count);
  await expect(trigger).toBeFocused();
}

test('mobile Full composer keeps a single compact header and direct actions across narrow widths', async ({
  page,
  backend,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const left = page.getByRole('region', { name: 'Left Agent' });
  await expect(left).toContainText('History for session-1');
  backend.setDiff('workspace-1', 'large.ts', 21769);
  const composer = left.locator('[data-composer="compact"]');
  const editor = left.getByRole('textbox', { name: 'Markdown editor' });
  await editor.fill('A short draft');
  for (const width of [320, 390, 700]) {
    await page.setViewportSize({ width, height: 844 });
    const header = composer.locator('[data-composer-header]');
    const footer = composer.locator('[data-composer-footer]');
    const summary = header.getByRole('button', { name: 'Change summary' });
    await expect(summary).toHaveText('1 file');
    for (const control of [
      summary,
      header.getByRole('button', { name: 'session-1', exact: true }),
      header.getByRole('combobox', { name: 'Chat view' }),
    ]) {
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y).toBeCloseTo((await summary.boundingBox())!.y, 0);
    }
    for (const name of [
      'Composer tools',
      'Composer settings',
      'Attach file',
      'Send',
    ]) {
      const button = footer.getByRole('button', { name, exact: true });
      await expect(button).toBeVisible();
      const box = (await button.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    expect((await composer.boundingBox())!.height).toBeLessThanOrEqual(200);
    await expect(editor).toHaveCSS('font-size', '16px');
  }
  await composer.getByRole('button', { name: 'Change summary' }).click();
  const summarySheet = await expectSheet(page);
  await expect(summarySheet).toContainText('+21769');
  await summarySheet
    .getByRole('button', { name: 'View changes', exact: true })
    .click();
  await expect(
    page.getByText('Diff requested for left:workspace-1')
  ).toBeVisible();
  await expect(editor).toHaveText('A short draft');
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect(
    left.getByRole('button', { name: 'Model A', exact: true })
  ).toBeVisible();
  await expect(
    left.getByRole('button', { name: 'Workspace tasks', exact: true })
  ).toBeVisible();
  await expect(editor).toHaveText('A short draft');
});

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
  for (const name of ['Composer settings', 'Composer tools', 'session-1']) {
    await test.step(name, () =>
      openAndDismiss(page, left.getByRole('button', { name, exact: true }))
    );
    await expect(editor).toHaveText('Keep this mobile draft');
  }
  await openAndDismiss(page, left.getByRole('combobox', { name: 'Chat view' }));
  await left
    .getByRole('button', { name: 'Composer tools', exact: true })
    .click();
  for (const name of [
    'Workspace tasks',
    'Preview slots',
    'Context usage',
    'Go to previous message',
  ]) {
    await openAndDismiss(page, page.getByRole('button', { name, exact: true }));
  }
  await page.keyboard.press('Escape');
  await left
    .getByRole('button', { name: 'Composer settings', exact: true })
    .click();
  await openAndDismiss(
    page,
    page.getByRole('button', { name: 'Preset', exact: true })
  );
  await page.getByRole('button', { name: 'Model A', exact: true }).click();
  await page.getByText('Model B', { exact: true }).click();
  await page.getByRole('button', { name: 'Low', exact: true }).click();
  await expectSheet(page);
  await page.getByRole('menuitem', { name: 'High', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Permissions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Plan', exact: true }).click();
  await page.keyboard.press('Escape');
  await right
    .getByRole('button', { name: 'Composer settings', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Model A', exact: true })
  ).toBeVisible();
  await page.keyboard.press('Escape');
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
  await create
    .getByRole('button', { name: 'Composer settings', exact: true })
    .click();
  for (const name of ['Opencode', 'Preset', 'Model A', 'Permissions']) {
    await openAndDismiss(page, page.getByRole('button', { name, exact: true }));
  }
  await page.keyboard.press('Escape');
  await expect(editor).toHaveText('Keep the mobile creation draft');
  await expect(
    create.getByRole('button', { name: 'repo · main', exact: true })
  ).toBeVisible();
  await create
    .getByRole('button', { name: 'Composer settings', exact: true })
    .click();
  await page.getByRole('button', { name: 'Model A', exact: true }).click();
  await page.locator('button[aria-label="Close"]').last().click();
  await expect(page.locator('[data-composer-sheet]')).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: 'Model A', exact: true })
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(
    create.getByRole('button', { name: 'Composer settings', exact: true })
  ).toBeFocused();
});

test('mobile sheets follow the visible keyboard viewport and dismiss from the backdrop', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const left = page.getByRole('region', { name: 'Left Agent' });
  const trigger = left.getByRole('button', { name: 'Composer tools' });
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
  await left.getByRole('button', { name: 'Composer tools' }).click();
  await page
    .getByRole('button', { name: 'Workspace tasks', exact: true })
    .click();
  const sheet = await expectSheet(page);
  await expect(
    sheet.getByText('task-29 · Open task 29', { exact: true })
  ).toBeAttached();
  const sessions = sheet.getByRole('combobox', {
    name: 'Housekeeping session',
  });
  await sessions.click();
  await expectSheet(page);
  await page.keyboard.press('Escape');
  await expect(sessions).toBeFocused();
  await expect(page.locator('[data-composer-sheet]')).toHaveCount(2);
  await sessions.click();
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
  await left.getByRole('button', { name: 'Composer settings' }).click();
  await page.getByRole('button', { name: 'Model A', exact: true }).click();
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
    page.getByRole('button', { name: 'Extra model 25', exact: true })
  ).toBeVisible();
});

test('mobile tools can open preview dialogs and return to the composer draft', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const left = page.getByRole('region', { name: 'Left Agent' });
  const editor = left.getByRole('textbox', { name: 'Markdown editor' });
  await editor.fill('Keep the tools draft');
  await left
    .getByRole('button', { name: 'Composer tools', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Preview slots', exact: true })
    .click();
  await page
    .getByRole('menuitem', {
      name: 'Logs for Application preview',
      exact: true,
    })
    .click();
  const logs = page.getByRole('dialog', {
    name: 'Preview server logs: Application preview',
  });
  await expect(logs.getByLabel('Preview server output')).toContainText(
    'Preview server listening'
  );
  await logs.getByRole('button', { name: 'Close', exact: true }).click();
  if (await page.locator('[data-composer-sheet]').count())
    await page.keyboard.press('Escape');
  await expect(editor).toHaveText('Keep the tools draft');
});

test('mobile attachment and queue actions remain directly reachable on a narrow screen', async ({
  page,
  backend,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/');
  const left = page.getByRole('region', { name: 'Left Agent' });
  await expect(left).toContainText('History for session-1');
  backend.stream('session-1', 'Executing');
  await expect(left).toContainText('Executing');
  const editor = left.getByRole('textbox', { name: 'Markdown editor' });
  await editor.fill('Queue this attachment');
  const chooser = page.waitForEvent('filechooser');
  await left.getByRole('button', { name: 'Attach file', exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: 'proof.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('proof'),
  });
  await expect(left).toContainText('proof.txt');
  await left.getByRole('button', { name: 'Queue', exact: true }).click();
  const cancel = left.getByRole('button', { name: /Cancel.*queue/i });
  await expect(cancel).toBeVisible();
  for (const button of [
    cancel,
    left.getByRole('button', { name: 'Stop', exact: true }),
  ]) {
    const box = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  }
  await cancel.click();
  await expect(editor).toContainText('Queue this attachment');
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
