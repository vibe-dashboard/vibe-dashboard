import { expect, test } from './backend';

test('two inline panes keep independent drafts, modes and lifetime', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  const left = page.getByRole('region', { name: 'Left Agent' });
  const right = page.getByRole('region', { name: 'Right Agent' });
  await expect(left).toContainText('History for session-1');
  await expect(right).toContainText('History for session-1');
  const composer = (pane: typeof left) =>
    pane.getByRole('textbox', { name: /Follow up|Markdown editor/ }).last();
  await composer(left).fill('Left unsent draft');
  await composer(right).fill('Right unsent draft');
  await left.getByRole('combobox', { name: 'Chat view' }).click();
  await page.getByRole('option', { name: 'Zen', exact: true }).click();
  await expect(
    right.getByRole('button', { name: 'Attach file' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Unmount left' }).click();
  await expect(composer(right)).toHaveText('Right unsent draft');
  await page.getByRole('button', { name: 'Mount left' }).click();
  await expect(composer(left)).toHaveText('Left unsent draft');
  await page.reload();
  await expect(composer(left)).toHaveText('Left unsent draft');
  await expect(composer(right)).toHaveText('Right unsent draft');
});

test('two sessions stream independently and restore their selections after reload', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  const left = page.getByRole('region', { name: 'Left Agent' });
  const right = page.getByRole('region', { name: 'Right Agent' });
  await right.getByRole('button', { name: 'session-1', exact: true }).click();
  await page.getByRole('menuitem', { name: /session-2$/ }).click();
  await expect(left).toContainText('History for session-1');
  await expect(right).toContainText('History for session-2');
  backend.stream('session-1', 'Left stream only');
  backend.stream('session-2', 'Right stream only');
  await expect(left).toContainText('Left stream only');
  await expect(right).toContainText('Right stream only');
  await expect(left).not.toContainText('Right stream only');
  await expect(right).not.toContainText('Left stream only');
  await page.getByRole('button', { name: 'Unmount left' }).click();
  backend.append(
    'session-2',
    backend.entry('Right still streaming after left unmount'),
  );
  await expect(right).toContainText('Right still streaming after left unmount');
  await page.reload();
  await expect(
    left.getByRole('button', { name: 'session-1', exact: true }),
  ).toBeVisible();
  await expect(
    right.getByRole('button', { name: 'session-2', exact: true }),
  ).toBeVisible();
});

test('same-session diff expansion stays local and unsupported navigation is omitted', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  const left = page.getByRole('region', { name: 'Left Agent' });
  const right = page.getByRole('region', { name: 'Right Agent' });
  await expect(right).toContainText('History for session-1');
  backend.stream('session-1', 'Shared session response');
  await expect(left).toContainText('Shared session response');
  await expect(right).toContainText('Shared session response');
  backend.append(
    'session-1',
    backend.entry('Write proof', {
      type: 'tool_use',
      tool_name: 'write_file',
      action_type: {
        action: 'file_edit',
        path: 'proof.txt',
        changes: [{ action: 'write', content: 'isolated diff content' }],
      },
      status: { status: 'success' },
    }),
  );
  const leftFile = left.getByRole('button', { name: /proof.txt/ }).first();
  const rightFile = right.getByRole('button', { name: /proof.txt/ }).first();
  await expect(leftFile).toHaveAttribute('aria-expanded', 'false');
  await expect(rightFile).toHaveAttribute('aria-expanded', 'false');
  await leftFile.click();
  await expect(leftFile).toHaveAttribute('aria-expanded', 'true');
  await expect(rightFile).toHaveAttribute('aria-expanded', 'false');
  await expect(left.getByTitle(/changes panel/i)).toHaveCount(0);
  await expect(right.getByTitle(/changes panel/i)).toHaveCount(0);
});

test('workspace diff summaries survive another workspace surface unmounting', async ({
  page,
  backend,
}) => {
  await page.goto('/?right=workspace-2');
  const left = page.getByRole('region', { name: 'Left Agent' });
  const right = page.getByRole('region', { name: 'Right Agent' });
  await expect(right).toContainText('History for session-3');
  backend.setDiff('workspace-1', 'left.txt', 11);
  backend.setDiff('workspace-2', 'right.txt', 22);
  await expect(left).toContainText('+11');
  await expect(right).toContainText('+22');
  await page.getByRole('button', { name: 'Unmount left' }).click();
  await expect(right).toContainText('+22');
});
