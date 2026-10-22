import { expect, test } from './backend';

test('a delayed server save cannot resurrect a submitted draft', async ({
  page,
  backend,
}) => {
  let releaseSave: () => void = () => {};
  let saveStarted: () => void = () => {};
  const saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  const started = new Promise<void>((resolve) => {
    saveStarted = resolve;
  });
  await page.route('**/api/scratch/DRAFT_FOLLOW_UP/*', async (route) => {
    if (route.request().method() === 'PUT') {
      saveStarted();
      await saveGate;
    }
    await route.fallback();
  });
  try {
    await page.goto('/');
    const left = page.getByRole('region', { name: 'Left Agent' });
    const composer = left
      .getByRole('textbox', { name: /Follow up|Markdown editor/ })
      .last();
    await composer.fill('Delayed draft');
    await started;
    await left.getByRole('button', { name: 'Send', exact: true }).click();
    await expect
      .poll(() =>
        backend.requests.some((request) => request.path.endsWith('/follow-up')),
      )
      .toBe(true);
    releaseSave();
    await expect
      .poll(() =>
        backend.requests.some(
          (request) =>
            request.method === 'DELETE' &&
            request.path.includes('/scratch/DRAFT_FOLLOW_UP/'),
        ),
      )
      .toBe(true);
    expect(backend.scratches.size).toBe(0);
    await page.reload();
    await expect(composer).toHaveText('');
  } finally {
    releaseSave();
  }
});

test('server drafts restore in a fresh browser and sending clears only its pane', async ({
  page,
  browser,
  backend,
}) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const left = page.getByRole('region', { name: 'Left Agent' });
  const right = page.getByRole('region', { name: 'Right Agent' });
  const composer = (region: typeof left) =>
    region.getByRole('textbox', { name: /Follow up|Markdown editor/ }).last();
  await composer(left).fill('Server left draft');
  await composer(right).fill('Server right draft');
  await expect
    .poll(() =>
      [...backend.scratches.values()]
        .map((scratch) => scratch.payload.data.message)
        .sort(),
    )
    .toEqual(['Server left draft', 'Server right draft']);

  const context = await browser.newContext();
  try {
    const otherPage = await context.newPage();
    const errors: string[] = [];
    otherPage.on('pageerror', (error) => errors.push(error.message));
    await backend.install(otherPage);
    await otherPage.goto(page.url());
    const otherLeft = otherPage.getByRole('region', { name: 'Left Agent' });
    const otherRight = otherPage.getByRole('region', { name: 'Right Agent' });
    await expect(composer(otherLeft)).toHaveText('Server left draft');
    await expect(composer(otherRight)).toHaveText('Server right draft');

    await composer(otherRight).fill('Updated server right draft');
    await expect
      .poll(() =>
        [...backend.scratches.values()]
          .map((scratch) => scratch.payload.data.message)
          .sort(),
      )
      .toEqual(['Server left draft', 'Updated server right draft']);
    await page.reload();
    await expect(composer(left)).toHaveText('Server left draft');
    await expect(composer(right)).toHaveText('Updated server right draft');

    await otherLeft.getByRole('button', { name: 'Send', exact: true }).click();
    await expect
      .poll(() =>
        [...backend.scratches.values()].map(
          (scratch) => scratch.payload.data.message,
        ),
      )
      .toEqual(['Updated server right draft']);
    await otherPage.reload();
    await expect(composer(otherLeft)).toHaveText('');
    await expect(composer(otherRight)).toHaveText('Updated server right draft');
    await page.reload();
    await expect(composer(left)).toHaveText('');
    await expect(composer(right)).toHaveText('Updated server right draft');
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('existing browser-only pane drafts are uploaded and recovered without browser storage', async ({
  page,
  browser,
  backend,
}) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await expect(
    page
      .getByRole('region', { name: 'Left Agent' })
      .getByRole('button', { name: 'Send', exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem(
      'vk:scratch-draft:DRAFT_FOLLOW_UP:surface:left:session-1',
      JSON.stringify({
        value: {
          message: 'Previously local draft',
          executor_config: { executor: 'OPENCODE', variant: 'DEFAULT' },
        },
        dirty: true,
        updatedAt: Date.now(),
      }),
    );
  });
  await page.reload();
  await expect
    .poll(() =>
      [...backend.scratches.values()].map(
        (scratch) => scratch.payload.data.message,
      ),
    )
    .toEqual(['Previously local draft']);
  const context = await browser.newContext();
  try {
    const freshPage = await context.newPage();
    await backend.install(freshPage);
    await freshPage.goto(page.url());
    await expect(
      freshPage
        .getByRole('region', { name: 'Left Agent' })
        .getByRole('textbox', { name: /Follow up|Markdown editor/ })
        .last(),
    ).toHaveText('Previously local draft');
  } finally {
    await context.close();
  }
});
