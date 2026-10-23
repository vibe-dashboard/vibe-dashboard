import { expect, test } from './backend';

test('all presets style chat and portals without losing two drafts or expanded diffs', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  const left = page.getByRole('region', { name: 'Left Agent' });
  const right = page.getByRole('region', { name: 'Right Agent' });
  const composer = (pane: typeof left) =>
    pane.getByRole('textbox', { name: /Follow up|Markdown editor/ }).last();
  await expect(left).toContainText('History for session-1');
  await composer(left).fill('Left theme-switch draft');
  await composer(right).fill('Right theme-switch draft');
  backend.stream('session-1', 'Theme stream');
  await expect(left).toContainText('Theme stream');
  backend.append(
    'session-1',
    backend.entry('Theme proof', {
      type: 'tool_use',
      tool_name: 'write_file',
      action_type: {
        action: 'file_edit',
        path: 'theme-proof.txt',
        changes: [{ action: 'write', content: 'const themed = true;' }],
      },
      status: { status: 'success' },
    }),
  );
  const diff = left.getByRole('button', { name: /theme-proof.txt/ }).first();
  await diff.click();
  const surfaces = new Set<string>();
  for (const id of ['neutral-dark', 'midnight', 'forest', 'sand', 'plum']) {
    await page.getByLabel('Theme preview', { exact: true }).selectOption(id);
    await expect(page.locator('html')).toHaveAttribute('data-theme', id);
    const background = await left
      .locator('[data-testid="inline-vk-agent-chat"]')
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    surfaces.add(background);
    expect(background).not.toBe('rgba(0, 0, 0, 0)');
    await expect(composer(left)).toHaveText('Left theme-switch draft');
    await expect(composer(right)).toHaveText('Right theme-switch draft');
    await expect(diff).toHaveAttribute('aria-expanded', 'true');
    await expect
      .poll(() =>
        left
          .locator('diffs-container')
          .first()
          .evaluate((el) =>
            el.shadowRoot
              ?.querySelector('[data-diff]')
              ?.getAttribute('data-theme-type'),
          ),
      )
      .toBe(id === 'sand' ? 'light' : 'dark');
    await left.getByRole('combobox', { name: 'Chat view' }).click();
    const portal = page.getByRole('listbox');
    await expect(portal).toBeVisible();
    expect(
      await portal.evaluate((el) => getComputedStyle(el).backgroundColor),
    ).not.toBe('rgba(0, 0, 0, 0)');
    await page.keyboard.press('Escape');
  }
  expect(surfaces.size).toBe(5);
  await page.evaluate(() => document.fonts.ready);
  expect(
    await composer(left).evaluate((el) => getComputedStyle(el).fontFamily),
  ).toContain('IBM Plex Mono');
  expect(
    await page.evaluate(() => document.fonts.check('16px "IBM Plex Mono"')),
  ).toBe(true);
  await page.getByLabel('Font preview', { exact: true }).selectOption('system');
  expect(
    await composer(left).evaluate((el) => getComputedStyle(el).fontFamily),
  ).not.toContain('IBM Plex Mono');
  await expect(composer(left)).toHaveText('Left theme-switch draft');
});

test('sidebar appearance controls are usable on mobile and report save failures', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?appearance-controls');
  const controls = page.getByRole('region', { name: 'Appearance' });
  await controls.getByRole('button').first().click();
  await page
    .getByRole('listbox')
    .getByRole('option', { name: 'Sand', exact: true })
    .click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sand');
  await controls.getByRole('button').nth(1).focus();
  await page.keyboard.press('Enter');
  await page
    .getByRole('listbox')
    .getByRole('option', { name: 'System UI', exact: true })
    .click();
  await expect(page.locator('html')).toHaveAttribute('data-ui-font', 'system');
  await page.goto('/?appearance-controls&fail-save');
  await controls.getByRole('button').first().click();
  await page
    .getByRole('listbox')
    .getByRole('option', { name: 'Forest', exact: true })
    .click();
  await expect(controls.getByRole('alert')).toHaveText(
    'Could not save appearance. Please try again.',
  );
  await expect(page.locator('html')).toHaveAttribute(
    'data-theme',
    'neutral-dark',
  );
  await expect(controls.getByRole('button').first()).toBeEnabled();
});
