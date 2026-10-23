import { expect, test } from './backend';

test('Escape dismisses workspace picker before and after focus transfer without changing the origin draft', async ({ page }) => {
  await page.goto('/?workspace-picker');
  const draft = page.getByRole('textbox', { name: 'Picker origin draft' });
  const open = page.getByRole('button', { name: 'Open workspace picker' });
  const dialog = page.getByRole('dialog', { name: /Open VK Workspace/ });
  await open.click();
  await expect(dialog).toBeVisible();
  await draft.dispatchEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  await expect(dialog).toBeHidden();
  await expect(draft).toHaveValue('Keep this draft');
  await open.click();
  const search = dialog.getByRole('textbox', { name: 'Search workspaces...' });
  await search.focus();
  await search.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(draft).toHaveValue('Keep this draft');
  await expect(open).toBeFocused();
});

test('Escape respects a pending workspace action from both sides of the focus boundary', async ({ page }) => {
  await page.goto('/?workspace-picker&pending');
  await page.getByRole('button', { name: 'Open workspace picker' }).click();
  const dialog = page.getByRole('dialog', { name: /Open VK Workspace/ });
  await expect(dialog).toBeVisible();
  await page.getByRole('textbox', { name: 'Picker origin draft' }).dispatchEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Search workspaces...' }).press('Escape');
  await expect(dialog).toBeVisible();
});
