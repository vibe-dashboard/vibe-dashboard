import { expect, test } from './backend';

test('preview scripts can be edited, restarted, streamed and deleted from the slot menu', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  const left = page.getByRole('region', { name: 'Left Agent' });
  await left.getByRole('button', { name: 'Preview slots' }).click();
  await left
    .getByRole('menuitem', { name: 'Edit Application preview', exact: true })
    .click();
  const edit = page.getByRole('dialog', {
    name: 'Edit preview slot: Application preview',
  });
  await expect(
    edit.getByRole('textbox', { name: 'Script', exact: true }),
  ).toHaveValue('npm run preview');
  await edit
    .getByRole('textbox', { name: 'Script', exact: true })
    .fill('npm run dev -- --host 0.0.0.0');
  await edit.getByRole('button', { name: 'Save script', exact: true }).click();
  await expect(edit).toHaveCount(0);
  await expect
    .poll(() => backend.previewCommand)
    .toBe('npm run dev -- --host 0.0.0.0');
  await left
    .getByRole('menuitem', { name: 'Restart Application preview', exact: true })
    .click();
  await expect(left.getByRole('status')).toHaveText(
    'Restarted Application preview.',
  );
  expect(backend.previewRestarts).toBe(1);
  await left
    .getByRole('menuitem', {
      name: 'Logs for Application preview',
      exact: true,
    })
    .click();
  const logs = page.getByRole('dialog', {
    name: 'Preview server logs: Application preview',
  });
  await expect(logs.getByLabel('Preview server output')).toContainText(
    'Preview server listening',
  );
  await expect(logs.getByLabel('Preview server output')).toContainText(
    'Preview warning',
  );
  await logs.getByRole('button', { name: 'Close', exact: true }).click();
  await left.getByRole('button', { name: 'Preview slots' }).click();
  await left
    .getByRole('menuitem', { name: 'Edit Application preview', exact: true })
    .click();
  await expect(
    edit.getByRole('textbox', { name: 'Script', exact: true }),
  ).toHaveValue('npm run dev -- --host 0.0.0.0');
  await edit
    .getByRole('button', { name: 'Delete preview slot', exact: true })
    .click();
  await expect(edit).toHaveCount(0);
  await expect(left.getByRole('menu')).toContainText(
    'No preview slots configured',
  );
  expect(backend.previewSlotEnabled).toBe(false);
});

test('failed actions preserve script edits and stopped slots show a logs empty state', async ({
  page,
}) => {
  await page.route('**/preview-slots/slot-1/script', (route) =>
    route.fulfill({
      status: 502,
      json: { message: 'Script could not be saved' },
    }),
  );
  await page.route('**/preview-slots/slot-1/restart', (route) =>
    route.fulfill({ status: 502, json: { message: 'Restart failed' } }),
  );
  await page.route('**/preview-slots/slot-1/process', (route) =>
    route.fulfill({
      json: { processId: null, message: 'No active preview process.' },
    }),
  );
  await page.goto('/');
  const left = page.getByRole('region', { name: 'Left Agent' });
  await left.getByRole('button', { name: 'Preview slots' }).click();
  await left
    .getByRole('menuitem', { name: 'Edit Application preview', exact: true })
    .click();
  const edit = page.getByRole('dialog', {
    name: 'Edit preview slot: Application preview',
  });
  await edit
    .getByRole('textbox', { name: 'Script', exact: true })
    .fill('unsaved script');
  await edit.getByRole('button', { name: 'Save script', exact: true }).click();
  await expect(edit.getByRole('alert')).toHaveText('Script could not be saved');
  await expect(
    edit.getByRole('textbox', { name: 'Script', exact: true }),
  ).toHaveValue('unsaved script');
  await edit.getByRole('button', { name: 'Cancel', exact: true }).click();
  await left.getByRole('button', { name: 'Preview slots' }).click();
  await left
    .getByRole('menuitem', { name: 'Restart Application preview', exact: true })
    .click();
  await expect(left.getByRole('status')).toHaveText('Restart failed');
  await expect(
    left.getByRole('menuitem', {
      name: 'Restart Application preview',
      exact: true,
    }),
  ).toBeEnabled();
  await left
    .getByRole('menuitem', {
      name: 'Logs for Application preview',
      exact: true,
    })
    .click();
  await expect(page.getByRole('dialog').getByRole('status')).toHaveText(
    'No active preview process.',
  );
});
