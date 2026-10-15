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
    await openSidebarIfNeeded(page);
    await expect(page.getByText(manifest.voyageName).first()).toBeVisible({
      timeout: 30_000,
    });
    await openSeededCraft(page, manifest.craftTitle);
    await closeSidebarOverlayIfPresent(page);

    const agentChat = page.getByTestId('inline-vk-agent-chat').last();
    await expect(agentChat).toContainText(manifest.followUpPrompt, {
      timeout: 60_000,
    });
    await expect(agentChat.getByRole('button', { name: 'Custom' })).toBeVisible(
      { timeout: 60_000 },
    );
    await expect(
      agentChat.getByRole('button', { name: 'Loading...' }),
    ).toHaveCount(0);
    await expect(
      agentChat.getByRole('button', { name: 'Attach file' }),
    ).toBeVisible();
    await expect(
      agentChat.getByRole('button', { name: 'Workspace tasks' }),
    ).toBeVisible();
    await expect(
      agentChat.getByRole('button', { name: 'Preview slots' }),
    ).toBeVisible();
    await agentChat.getByRole('button', { name: 'Preview slots' }).click();
    await expect(
      agentChat.getByRole('menuitem', { name: 'Configure preview slots' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');

    const composer = getChatComposer(agentChat);
    await composer.fill('Draft survives view mode changes');
    await agentChat.getByRole('combobox', { name: 'Chat view' }).click();
    await page.getByRole('option', { name: 'Zen', exact: true }).click();
    await expect(
      agentChat.getByRole('button', { name: 'Attach file' }),
    ).toHaveCount(0);
    await expect(composer).toHaveText('Draft survives view mode changes');
    await agentChat.getByRole('combobox', { name: 'Chat view' }).click();
    await page.getByRole('option', { name: 'Full', exact: true }).click();
    await expect(
      agentChat.getByRole('button', { name: 'Attach file' }),
    ).toBeVisible();

    await composer.fill(proofFollowUp);
    await expect(agentChat.getByRole('button', { name: 'Send' })).toBeEnabled({
      timeout: 60_000,
    });
    await agentChat.getByRole('button', { name: 'Send' }).click();

    await expect(agentChat).toContainText(proofFollowUp);
    await expect(agentChat).toContainText('Ran a test command', {
      timeout: 60_000,
    });
  });
});

async function openSidebarIfNeeded(page: Page) {
  const openCraftButton = page
    .getByRole('button', { name: 'Open Craft' })
    .first();
  const openSidebarButton = page
    .getByRole('button', { name: 'Open sidebar' })
    .first();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const shellReady = await expect
      .poll(
        async () =>
          (await openCraftButton.isVisible().catch(() => false)) ||
          (await openSidebarButton.isVisible().catch(() => false)),
        { timeout: 30_000 },
      )
      .toBe(true)
      .then(() => true)
      .catch(() => false);
    if (shellReady) break;
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
  if (await openCraftButton.isVisible().catch(() => false)) {
    const box = await openCraftButton.boundingBox();
    if (box && box.x >= 0) return;
  }

  await openSidebarButton.click();
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

  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) {
      await candidate.evaluate((element) =>
        (element as HTMLButtonElement).click(),
      );
      return;
    }
  }

  await locator.first().evaluate((element) =>
    (element as HTMLButtonElement).click(),
  );
}

async function closeSidebarOverlayIfPresent(page: Page) {
  const overlay = page.getByRole('button', { name: 'Close sidebar overlay' });
  if (await overlay.isVisible().catch(() => false)) {
    await overlay.evaluate((button) => (button as HTMLButtonElement).click());
  }
}

async function openSeededCraft(page: Page, craftTitle: string) {
  await clickLocatorInViewport(
    page,
    page.getByRole('button', { name: 'Open Craft' }),
  );
  await expect(
    page.getByRole('heading', { name: 'Open VK Workspace' }),
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Search workspaces...' })
    .fill(craftTitle);
  await page
    .getByRole('button', { name: new RegExp(escapeRegex(craftTitle)) })
    .click();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getChatComposer(agentChat: Locator) {
  return agentChat
    .getByRole('textbox', { name: /^(Follow up|Markdown editor)$/ })
    .last();
}
