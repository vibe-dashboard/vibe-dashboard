import { expect, test } from './backend';

test('approval subscriptions remain bounded while rows mount and panes switch or unmount', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  const left = page.getByRole('region', { name: 'Left Agent' });
  const right = page.getByRole('region', { name: 'Right Agent' });
  const connections = () =>
    backend.activeSocketCount('/api/approvals/stream/ws');
  await expect(left).toContainText('History for session-1');
  await right.getByRole('button', { name: 'session-1', exact: true }).click();
  await page.getByRole('menuitem', { name: /session-2$/ }).click();
  await expect(right).toContainText('History for session-2');
  await expect.poll(connections).toBe(2);
  backend.stream('session-1', 'Approval on left');
  backend.stream('session-2', 'Approval on right');
  backend.approval('session-1');
  backend.approval('session-2');
  await expect(
    left.getByRole('button', { name: 'Approve', exact: true }),
  ).toBeVisible();
  await expect(
    right.getByRole('button', { name: 'Approve', exact: true }),
  ).toBeVisible();
  await expect.poll(connections).toBe(2);
  await page.getByRole('button', { name: 'Unmount left', exact: true }).click();
  await expect.poll(connections).toBe(1);
  await right.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(right).toContainText('Approval response received');
  await page.getByRole('button', { name: 'Mount left', exact: true }).click();
  await expect(
    left.getByRole('button', { name: 'Approve', exact: true }),
  ).toBeVisible();
  await expect.poll(connections).toBe(2);
  await left.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(left).toContainText('Approval response received');
});

for (const mode of ['agent', 'create'] as const) {
  test(`native image clipboard paste uploads once and retains the ${mode} draft`, async ({
    page,
    context,
    backend,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(mode === 'create' ? '/?create' : '/');
    if (mode === 'create') {
      await page.getByRole('button', { name: 'Recent', exact: true }).click();
      await page.getByText('repo', { exact: true }).click();
      await page.getByRole('option', { name: /main/ }).click();
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
    }
    const surface =
      mode === 'create'
        ? page.getByTestId('inline-vk-create-workspace')
        : page.getByRole('region', { name: 'Left Agent' });
    const editor = surface
      .getByRole('textbox', { name: /Follow up|Markdown editor/ })
      .last();
    await editor.fill(`Keep ${mode} draft`);
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 2;
      const image = await new Promise<Blob>((resolve) =>
        canvas.toBlob((blob) => resolve(blob!), 'image/png'),
      );
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': image }),
      ]);
    });
    const upload = page.waitForRequest((request) =>
      request.url().includes('/attachments/upload'),
    );
    await editor.focus();
    await page.keyboard.press('Control+v');
    expect((await upload).postDataBuffer()?.toString('latin1')).toContain(
      'image/png',
    );
    await expect(surface).toContainText('proof.txt');
    await expect(editor).toContainText(`Keep ${mode} draft`);
    expect(
      backend.requests.filter((request) =>
        request.path.endsWith('/attachments/upload'),
      ),
    ).toHaveLength(1);
    if (mode === 'agent') {
      const right = page.getByRole('region', { name: 'Right Agent' });
      await expect(
        right
          .getByRole('textbox', { name: /Follow up|Markdown editor/ })
          .last(),
      ).toBeEmpty();
    }
  });
}
