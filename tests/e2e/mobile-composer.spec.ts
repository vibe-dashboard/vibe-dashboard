import { expect, test } from 'playwright/test';
import { InlineChatBackend } from '../browser/inline-chat/backend';

test('Full, Chat and Zen composers stay above mobile navigation with browser chrome expanded', async ({
  page, request,
}, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 375, height: 553 });
  const cdp = await page.context().newCDPSession(page);
  // Reproduce mobile browser chrome: 100vh is 667px but only 553px is visible.
  await cdp.send('Emulation.setSmallViewportHeightDifferenceOverride', { difference: 114 });
  const backend = new InlineChatBackend();
  await backend.install(page);
  await page.goto('/');
  await expect.poll(async () => {
    const response = await request.get('/kv/get-all').catch(() => null);
    if (!response?.headers()['content-type']?.includes('application/json')) return false;
    return !!(await response.json())['engine|module|workspace|state.persistent|workspace'];
  }, { timeout: 30_000 }).toBe(true);
  const response = await request.post('/rpc/createSavedSessionForVKWorkspace', {
    data: {
      jsonrpc: '2.0', id: 1,
      method: 'engine|module|workspace|action|createSavedSessionForVKWorkspace',
      params: {
        voyageName: 'Mobile composer regression', taskAttemptId: 'workspace-1',
        workspaceName: 'Mobile composer craft', containerRef: '/tmp/mobile-composer-repo',
        activeSpaceId: 'space_home',
        composition: { tabs: [], pairTabKeys: [], primaryTabKey: 'agent' },
      },
    },
  });
  const result = await response.json();
  expect(result.error).toBeUndefined();
  const created = result.result;
  if (!created) throw new Error('Could not create mobile composer fixture');
  try {
    await page.goto(`/?voyage=${encodeURIComponent(created.savedSession.id)}`);
    const chat = page.getByTestId('inline-vk-agent-chat');
    await expect(chat).toContainText('History for session-1', { timeout: 60_000 });
    const editor = chat.getByRole('textbox', { name: /Follow up|Markdown editor/ }).last();
    await editor.fill('Mobile draft must stay reachable');
    for (const mode of ['Full', 'Chat', 'Zen']) {
      await chat.getByRole('combobox', { name: 'Chat view' }).click();
      await page.getByRole('option', { name: mode, exact: true }).click();
      await expect(editor).toHaveText('Mobile draft must stay reachable');
      await expect.poll(async () => {
        const footer = await page.getByRole('button', { name: 'Open sidebar', exact: true })
          .locator('..').boundingBox();
        if (!footer) return ['missing mobile navigation'];
        return chat.locator('[data-chatbox-container="true"]').evaluate((box, footerTop) =>
          [...box.querySelectorAll<HTMLElement>('button, [role="textbox"], [role="combobox"]')]
            .filter((control) => control.getBoundingClientRect().width > 0)
            .filter((control) => {
              const rect = control.getBoundingClientRect();
              const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
              return rect.top < 0 || rect.bottom > footerTop || rect.left < 0 ||
                rect.right > innerWidth || !hit || !control.contains(hit);
            })
            .map((control) => control.getAttribute('aria-label') || control.textContent), footer.y);
      }).toEqual([]);
      await testInfo.attach(`mobile-${mode.toLowerCase()}`, {
        body: await page.screenshot(), contentType: 'image/png',
      });
    }
    expect(backend.requests.filter((item) => item.path.endsWith('/follow-up'))).toEqual([]);
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
