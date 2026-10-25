import { expect, test } from 'playwright/test';

test('uses Alohak branding and requires confirmed Git identity before the first voyage', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  // The base KV health route can be ready before dev-mode application routes.
  await expect.poll(async () => {
    try {
      const response = await request.get('/dashboard/api/git-identity', { timeout: 10_000 });
      return response.ok() && (await response.json()).configured === true;
    } catch {
      return false;
    }
  }, { timeout: 60_000 }).toBe(true);
  let confirmed = false;
  await page.route('**/dashboard/api/git-identity', async (route) => {
    if (route.request().method() === 'PUT') {
      expect(route.request().postDataJSON()).toEqual({
        name: 'Actual User',
        email: 'actual@example.com',
      });
      confirmed = true;
    }
    await route.fulfill({
      json: {
        name: confirmed ? 'Actual User' : '',
        email: confirmed ? 'actual@example.com' : '',
        configured: confirmed,
      },
    });
  });
  await page.route('**/dashboard/api/git-identity/github', (route) =>
    route.fulfill({
      json: { name: 'Actual User', email: 'actual@example.com' },
    }),
  );
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle('Alohak');
  await expect(
    page.getByRole('heading', { name: 'Welcome to Alohak', exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByRole('button', { name: 'Save identity and continue' }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'Use connected GitHub profile' })
    .click();
  await expect(page.getByLabel('Git email')).toHaveValue('actual@example.com');
  expect(confirmed).toBe(false);
  await page
    .getByRole('button', { name: 'Save identity and continue' })
    .click();
  await expect(
    page.getByRole('heading', {
      name: 'Welcome to Alohak. Let’s create your first voyage and get hacking!',
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('img', { name: 'Alohak', exact: true }),
  ).toBeVisible();
  const manifest = await (await request.get('/manifest.json')).json();
  expect((await request.get('/dashboard/api/git-identity')).status()).toBe(200);
  expect(manifest).toMatchObject({ name: 'Alohak', short_name: 'Alohak' });
  for (const icon of manifest.icons) {
    const response = await request.get(icon.src);
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['content-type']).toContain('image/png');
  }
});
