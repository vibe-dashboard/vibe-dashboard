import { expect, test } from 'playwright/test';
import { InlineChatBackend } from '../browser/inline-chat/backend';

test('craft context menu opens two independent Agent views through the native app split', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(20_000);
  const backend = new InlineChatBackend();
  await backend.install(page);
  await expect
    .poll(async () => {
      const response = await request.get('/kv/get-all').catch(() => null);
      if (!response?.headers()['content-type']?.includes('application/json')) return false;
      const entries = await response.json();
      return !!entries['engine|module|workspace|state.persistent|workspace'];
    }, { timeout: 30_000 })
    .toBe(true);
  let result: {
    result?: {
      savedSession: { id: string };
      selection: { spaceId: string; tabGroupId: string };
    };
    error?: unknown;
  } = {};
  await expect
    .poll(async () => {
      const response = await request.post('/rpc/createSavedSessionForVKWorkspace', {
        data: {
          jsonrpc: '2.0',
          id: 1,
          method: 'engine|module|workspace|action|createSavedSessionForVKWorkspace',
          params: {
            voyageName: 'Native split acceptance',
            taskAttemptId: 'workspace-1',
            workspaceName: 'Native Split Craft',
            containerRef: '/tmp/native-split-repo',
            activeSpaceId: 'space_home',
            composition: { tabs: [], pairTabKeys: [], primaryTabKey: 'agent' },
          },
        },
      });
      if (!response.ok()) return false;
      result = await response.json();
      return !!result.result;
    }, { timeout: 30_000 })
    .toBe(true);
  expect(result.error).toBeUndefined();
  const created = result.result;
  if (!created) throw new Error('The fixture voyage was not created');
  const voyage = created.savedSession;
  try {
    await page.goto(`/?voyage=${encodeURIComponent(voyage.id)}`, { waitUntil: 'domcontentloaded' });
    const craftTab = page.getByRole('button', { name: /^Open Native Split Craft in / }).first();
    await expect(craftTab).toBeVisible();
    await craftTab.click({ button: 'right' });
    await page.getByRole('button', { name: 'Split this workspace’s Agents', exact: true }).click();
    const agents = page.getByTestId('inline-vk-agent-chat');
    await expect(agents).toHaveCount(2, { timeout: 60_000 });
    const left = agents.nth(0);
    const right = agents.nth(1);
    await expect(left).toContainText('History for session-1');
    await right.getByRole('button', { name: 'session-1', exact: true }).click();
    await page.getByRole('menuitem', { name: /session-2$/ }).click();
    await expect(right).toContainText('History for session-2');

    const beforeResize = await left.boundingBox();
    const separator = await page.getByRole('separator').first().boundingBox();
    if (!beforeResize || !separator) throw new Error('Native split did not expose its resize handle');
    await page.mouse.move(separator.x + separator.width / 2, separator.y + separator.height / 2);
    await page.mouse.down();
    await page.mouse.move(separator.x + 60, separator.y + separator.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect
      .poll(async () => Math.abs((await left.boundingBox())!.width - beforeResize.width))
      .toBeGreaterThan(20);

    backend.stream('session-1', 'Native left stream');
    backend.stream('session-2', 'Native right stream');
    await expect(left).toContainText('Native left stream');
    await expect(right).toContainText('Native right stream');
    await expect(left).not.toContainText('Native right stream');
    await expect(right).not.toContainText('Native left stream');
    const leftComposer = left.getByRole('textbox', { name: /Follow up|Markdown editor/ }).last();
    const rightComposer = right.getByRole('textbox', { name: /Follow up|Markdown editor/ }).last();
    await leftComposer.fill('Native left draft');
    await rightComposer.fill('Native right draft');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(agents).toHaveCount(2, { timeout: 60_000 });
    await expect(leftComposer).toHaveText('Native left draft');
    await expect(rightComposer).toHaveText('Native right draft');
    await expect(right.getByRole('button', { name: 'session-2', exact: true })).toBeVisible();

    await craftTab.click({ button: 'right' });
    await page.getByRole('button', { name: 'Split this workspace’s Agents', exact: true }).click();
    await expect(agents).toHaveCount(2);
    await page.getByRole('button', { name: 'Open sidebar', exact: true }).first().click();
    await page.getByRole('button', { name: 'Agent', exact: true }).first().click();
    await expect(agents).toHaveCount(1);
    await page.getByRole('button', { name: 'Close sidebar', exact: true }).click();
    await craftTab.click({ button: 'right' });
    await page.getByRole('button', { name: 'Split this workspace’s Agents', exact: true }).click();
    await expect(agents).toHaveCount(2);
    await expect(rightComposer).toHaveText('Native right draft');
    expect(backend.unexpected).toEqual([]);
  } finally {
    await page.close();
    await request.post('/rpc/deleteSavedSession', {
      timeout: 5000,
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'engine|module|workspace|action|deleteSavedSession',
        params: { id: voyage.id },
      },
    }).catch(() => {});
    await request.post('/rpc/deleteTabGroup', {
      timeout: 5000,
      data: {
        jsonrpc: '2.0',
        id: 2,
        method: 'engine|module|workspace|action|deleteTabGroup',
        params: {
          spaceId: created.selection.spaceId,
          tabGroupId: created.selection.tabGroupId,
        },
      },
    }).catch(() => {});
  }
});
