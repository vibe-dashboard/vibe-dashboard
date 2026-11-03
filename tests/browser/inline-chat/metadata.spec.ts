import { expect, test } from './backend';

test('profile reload refreshes shared metadata and failed refresh retains usable controls', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  const left = page.getByRole('region', { name: 'Left Agent' });
  const right = page.getByRole('region', { name: 'Right Agent' });
  await expect(
    right.getByRole('button', { name: 'Model A', exact: true }),
  ).toBeVisible();
  await page.route('**/api/profiles', (route) =>
    route.fulfill({ status: 503, body: 'Profile save unavailable' }),
  );
  backend.discoveryError = 'Provider temporarily unavailable';
  backend.discoveryDelayMs = 1000;
  await left.getByRole('button', { name: 'Model A', exact: true }).click();
  await page.getByText('Model B', { exact: true }).click();
  await page.keyboard.press('Escape');
  const retry = right.getByRole('button', { name: 'Retry', exact: true });
  await expect(retry).toBeVisible();
  await expect(
    right.getByRole('button', { name: 'Model A', exact: true }),
  ).toBeVisible();
  backend.discoveryError = null;
  backend.discoveryModelAName = 'Updated Model A';
  await retry.click();
  await expect(
    right.getByRole('button', { name: 'Updated Model A', exact: true }),
  ).toBeVisible();
  await expect(
    left.getByRole('button', { name: 'Model B · Low', exact: true }),
  ).toBeVisible();
});

test('warm remount reuses model/reasoning metadata and preserves surface-local drafts', async ({
  page,
  backend,
}) => {
  backend.discoveryDelayMs = 1500;
  await page.goto('/');
  const left = page.getByRole('region', { name: 'Left Agent' });
  const right = page.getByRole('region', { name: 'Right Agent' });
  await expect(
    left.getByRole('button', { name: 'Loading...', exact: true }),
  ).toBeVisible();
  const coldStart = Date.now();
  await left.getByRole('button', { name: 'Model A', exact: true }).click();
  const coldMs = Date.now() - coldStart;
  await page.getByText('Model B', { exact: true }).click();
  await page.getByRole('button', { name: 'Low', exact: true }).click();
  await page.getByRole('menuitem', { name: 'High', exact: true }).click();
  await page.keyboard.press('Escape');
  const editor = left
    .getByRole('textbox', { name: /Follow up|Markdown editor/ })
    .last();
  await editor.fill('Left draft with model B');
  await expect
    .poll(() =>
      [...backend.scratches.values()].some((scratch) =>
        JSON.stringify(scratch).includes('Left draft with model B'),
      ),
    )
    .toBe(true);
  await expect(
    right.getByRole('button', { name: 'Model A', exact: true }),
  ).toBeVisible();
  const connections = backend.discoveryConnections.length;
  backend.metadataDelayMs = 3000;
  await page.getByRole('button', { name: 'Unmount left', exact: true }).click();
  const warmStart = Date.now();
  await page.getByRole('button', { name: 'Mount left', exact: true }).click();
  await expect(
    left.getByRole('button', { name: 'Model B · High', exact: true }),
  ).toBeVisible();
  const warmMs = Date.now() - warmStart;
  expect(warmMs).toBeLessThan(backend.metadataDelayMs);
  await expect(editor).toContainText('Left draft with model B');
  expect(backend.discoveryConnections.length).toBe(connections);
  await expect(
    right.getByRole('button', { name: 'Model A', exact: true }),
  ).toBeVisible();
  console.info(
    `Discovery delay=1500ms, reconnect delay=3000ms: cold controls=${coldMs}ms, warm controls=${warmMs}ms`,
  );
});

test('session switching loads a separate catalog and restores matching cached settings', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  const left = page.getByRole('region', { name: 'Left Agent' });
  await left.getByRole('button', { name: 'Model A', exact: true }).click();
  await page.getByText('Model B', { exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(
    left.getByRole('button', { name: 'Model B · Low', exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      [...backend.scratches.values()].some((scratch) =>
        JSON.stringify(scratch).includes('model-b'),
      ),
    )
    .toBe(true);
  const sessionOneConnections = backend.discoveryConnections.filter((url) =>
    url.includes('session_id=session-1'),
  ).length;
  backend.discoveryDelayMs = 1500;
  await left.getByRole('button', { name: 'session-1', exact: true }).click();
  await page.getByRole('menuitem', { name: /session-2$/ }).click();
  await expect(
    left.getByRole('button', { name: 'Loading...', exact: true }),
  ).toBeVisible();
  await expect(
    left.getByRole('button', { name: 'Model A', exact: true }),
  ).toBeVisible();
  await left.getByRole('button', { name: 'session-2', exact: true }).click();
  await page.getByRole('menuitem', { name: /session-1$/ }).click();
  await expect(
    left.getByRole('button', { name: 'Model B · Low', exact: true }),
  ).toBeVisible();
  expect(
    backend.discoveryConnections.filter((url) =>
      url.includes('session_id=session-1'),
    ).length,
  ).toBe(sessionOneConnections);
});

test('failed cold discovery exposes retry and recovers when the provider returns', async ({
  page,
  backend,
}) => {
  backend.discoveryError = 'Provider temporarily unavailable';
  await page.goto('/');
  const left = page.getByRole('region', { name: 'Left Agent' });
  const retry = left.getByRole('button', { name: 'Retry', exact: true });
  await expect(retry).toBeVisible();
  backend.discoveryError = null;
  await retry.click();
  await expect(
    left.getByRole('button', { name: 'Model A', exact: true }),
  ).toBeVisible();
});

test('cached process configuration survives reconnect then accepts updated server configuration', async ({
  page,
  backend,
}) => {
  backend.stream('session-1', 'Configured session', {
    executor: 'OPENCODE',
    variant: 'DEFAULT',
    model_id: 'model-b',
    reasoning_id: 'high',
  });
  await page.goto('/?right=workspace-2');
  const left = page.getByRole('region', { name: 'Left Agent' });
  await expect(
    left.getByRole('button', { name: 'Model B · High', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Unmount left', exact: true }).click();
  backend.metadataDelayMs = 3000;
  backend.stream('session-1', 'Updated configuration', {
    executor: 'OPENCODE',
    variant: 'DEFAULT',
    model_id: 'model-a',
  });
  const start = Date.now();
  await page.getByRole('button', { name: 'Mount left', exact: true }).click();
  await expect(
    left.getByRole('button', { name: 'Model B · High', exact: true }),
  ).toBeVisible();
  expect(Date.now() - start).toBeLessThan(backend.metadataDelayMs);
  await expect(
    left.getByRole('button', { name: 'Model A', exact: true }),
  ).toBeVisible();
});
