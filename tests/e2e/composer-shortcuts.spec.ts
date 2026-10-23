import { expect, test, type Locator, type Page } from 'playwright/test';
import { InlineChatBackend } from '../browser/inline-chat/backend';

async function checkOpenCraftShortcut(page: Page, composer: Locator, draft: string) {
  await composer.fill(draft);
  for (const shortcut of ['Control+k', 'Meta+k']) {
    await composer.focus();
    await expect(composer).toBeFocused();
    await composer.press(shortcut);
    const modal = page.getByRole('dialog', { name: 'Open VK Workspace' });
    await expect(modal).toBeVisible();
    if (shortcut === 'Control+k') {
      await composer.dispatchEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true });
    } else {
      await page.keyboard.press('Escape');
    }
    await expect(modal).toBeHidden();
    await expect(composer).toHaveText(draft);
  }
}

test('Open Craft shortcut works from both native composers without submitting or losing drafts', async ({ page, request }) => {
  test.setTimeout(300_000);
  const backend = new InlineChatBackend();
  await backend.install(page);
  await page.goto('/');
  await expect.poll(async () => {
    const response = await request.get('/kv/get-all').catch(() => null);
    if (!response?.headers()['content-type']?.includes('application/json')) return false;
    const entries = await response.json();
    return !!entries['engine|module|workspace|state.persistent|workspace'];
  }, { timeout: 30_000 }).toBe(true);
  const response = await request.post('/rpc/createSavedSessionForVKWorkspace', {
    data: {
      jsonrpc: '2.0', id: 1,
      method: 'engine|module|workspace|action|createSavedSessionForVKWorkspace',
      params: {
        voyageName: 'Composer shortcuts', taskAttemptId: 'workspace-1',
        workspaceName: 'Shortcut craft', containerRef: '/tmp/shortcut-repo',
        activeSpaceId: 'space_home',
        composition: { tabs: [], pairTabKeys: [], primaryTabKey: 'agent' },
      },
    },
  });
  const result = await response.json();
  expect(result.error).toBeUndefined();
  const created = result.result;
  if (!created) throw new Error('Could not create shortcut fixture');
  try {
    await page.goto(`/?voyage=${encodeURIComponent(created.savedSession.id)}`);
    await page.getByRole('button', { name: /^Open Shortcut craft in / }).first().click();
    const chat = page.getByTestId('inline-vk-agent-chat');
    await expect(chat).toContainText('History for session-1', { timeout: 60_000 });
    await checkOpenCraftShortcut(
      page,
      chat.getByRole('textbox', { name: /Follow up|Markdown editor/ }).last(),
      'Keep the chat draft',
    );
    await page.getByRole('button', { name: 'Open sidebar', exact: true }).first().click();
    await page.getByRole('button', { name: 'New Craft', exact: true }).first().click();
    const create = page.getByTestId('inline-vk-create-workspace');
    await expect(create).toBeVisible();
    const createComposer = create.getByRole('textbox', { name: 'Markdown editor' });
    if (!(await createComposer.isVisible())) {
      await create.getByRole('button', { name: 'Recent', exact: true }).click();
      await page.getByRole('option', { name: 'repo', exact: true }).click();
      await page.getByRole('option', { name: /main/ }).click();
      await create.getByRole('button', { name: 'Continue', exact: true }).click();
    }
    await checkOpenCraftShortcut(page, createComposer, 'Keep the new workspace draft');
    await createComposer.focus();
    await createComposer.press('Control+[');
    await expect(chat).toBeVisible();
    const chatComposer = chat.getByRole('textbox', { name: /Follow up|Markdown editor/ }).last();
    await expect(chatComposer).toHaveText('Keep the chat draft');
    await chatComposer.focus();
    await chatComposer.press('Control+]');
    await expect(create).toBeVisible();
    expect(backend.requests.filter((item) => item.method === 'POST' &&
      (item.path.endsWith('/follow-up') || item.path === '/api/workspaces'))).toEqual([]);
  } finally {
    await page.close();
    for (const [action, params] of [
      ['deleteSavedSession', { id: created.savedSession.id }],
      ['deleteTabGroup', created.selection],
    ] as const) {
      await request.post(`/rpc/${action}`, {
        timeout: 5000,
        data: { jsonrpc: '2.0', id: 1, method: `engine|module|workspace|action|${action}`, params },
      }).catch(() => {});
    }
  }
});
