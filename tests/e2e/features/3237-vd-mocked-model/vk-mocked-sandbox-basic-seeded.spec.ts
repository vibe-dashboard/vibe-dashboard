import { expect, test, type Locator, type Page } from 'playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

type SeedManifest = {
  voyageName: string;
  craftTitle: string;
  followUpPrompt: string;
  model: string;
};

const sandboxUrl = process.env.VK_MOCKED_SANDBOX_URL ?? 'http://localhost:50005';
const manifestPath = path.join(
  process.cwd(),
  'tests/e2e/fixtures/vk-mocked-sandbox/basic-seeded/manifest.json',
);

test.describe('VK mocked-provider basic-seeded fixture', () => {
  test('opens the seeded VD craft and sends another qa-mode follow-up', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const manifest = JSON.parse(
      await readFile(manifestPath, 'utf8'),
    ) as SeedManifest;
    const proofFollowUp = `${manifest.followUpPrompt} Proof-of-concept reuse ${Date.now()}.`;

    await page.goto(sandboxUrl);
    await expect(page.getByText(manifest.voyageName).first()).toBeVisible();

    await openSidebarIfNeeded(page);
    await clickLocatorInViewport(
      page,
      page.getByRole('button', { name: 'Open Craft' }),
    );
    await expect(
      page.getByRole('heading', { name: 'Open VK Workspace' }),
    ).toBeVisible();
    await page
      .getByRole('textbox', { name: 'Search workspaces...' })
      .fill(manifest.craftTitle);
    await page
      .getByRole('button', { name: new RegExp(escapeRegex(manifest.craftTitle)) })
      .click();

    const agentFrame = page.frameLocator('iframe[title="Agent"]').first();
    await expect(agentFrame.locator('body')).toContainText(manifest.craftTitle);

    await expect(page.locator('iframe[title="Agent"]').first()).toHaveAttribute(
      'src',
      /\/vscode\?chat_only=true&session_id=/,
    );
    await expect(
      agentFrame.getByRole('textbox', { name: 'Markdown editor' }),
    ).toHaveCount(0);
    await page
      .getByRole('textbox', { name: 'Follow-up message' })
      .fill(proofFollowUp);
    await page.getByRole('button', { name: 'Send', exact: true }).click();

    await expect(agentFrame.locator('body')).toContainText(proofFollowUp);
    await expect(agentFrame.locator('body')).toContainText('Ran a test command', {
      timeout: 60_000,
    });
  });
});

async function openSidebarIfNeeded(page: Page) {
  const openCraftButton = page
    .getByRole('button', { name: 'Open Craft' })
    .first();
  if (await openCraftButton.isVisible()) {
    const box = await openCraftButton.boundingBox();
    if (box && box.x >= 0) return;
  }

  await page.getByRole('button', { name: 'Open sidebar' }).first().click();
  await expect(openCraftButton).toBeVisible();
}

async function clickLocatorInViewport(page: Page, locator: Locator) {
  const viewport = page.viewportSize();
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const box = await locator.nth(index).boundingBox().catch(() => null);
    if (
      box &&
      box.x >= 0 &&
      box.y >= 0 &&
      (!viewport || box.x + box.width <= viewport.width) &&
      (!viewport || box.y + box.height <= viewport.height)
    ) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      return;
    }
  }

  await locator
    .first()
    .evaluate((element) => (element as HTMLButtonElement).click());
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
