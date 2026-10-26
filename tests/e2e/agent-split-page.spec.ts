import { expect, test } from 'playwright/test';
import { InlineChatBackend } from '../browser/inline-chat/backend';

test('the split page runs two different workspace Agents and restores their independent state', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(20_000);
  const backend = new InlineChatBackend();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await backend.install(page);
  await expect.poll(async () => {
    const response = await request.get('/kv/get-all').catch(() => null);
    if (!response?.headers()['content-type']?.includes('application/json')) return false;
    const entries = await response.json();
    return !!entries['engine|module|workspace|state.persistent|workspace'];
  }, { timeout: 30_000 }).toBe(true);

  type CreatedCraft = {
    savedSession: { id: string };
    selection: { spaceId: string; tabGroupId: string };
  };
  const created: CreatedCraft[] = [];
  try {
    for (const [workspaceId, name] of [
      ['workspace-1', 'Split Left Craft'],
      ['workspace-2', 'Split Right Craft'],
    ]) {
      let fixture: CreatedCraft | undefined;
      await expect.poll(async () => {
        const response = await request.post('/rpc/createSavedSessionForVKWorkspace', {
          data: {
            jsonrpc: '2.0', id: 1,
            method: 'engine|module|workspace|action|createSavedSessionForVKWorkspace',
            params: {
              voyageName: name, taskAttemptId: workspaceId, workspaceName: name,
              containerRef: `/tmp/${workspaceId}`, activeSpaceId: 'space_home',
              composition: { tabs: [], pairTabKeys: [], primaryTabKey: 'agent' },
            },
          },
        });
        if (!response.ok()) return false;
        fixture = (await response.json()).result;
        return !!fixture;
      }, { timeout: 30_000 }).toBe(true);
      if (!fixture) throw new Error(`Could not create ${name}`);
      created.push(fixture);
    }
    const [leftCraft, rightCraft] = created;
    if (!leftCraft || !rightCraft) throw new Error('Both workspace fixtures are required');
    await page.goto(`/?voyage=${encodeURIComponent(leftCraft.savedSession.id)}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /^Open Split Left Craft in / }).first().click({ button: 'right' });
    await page.getByRole('button', { name: 'Show in split view', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Workspace split view' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Left workspace', exact: true }))
      .toHaveValue(leftCraft.selection.tabGroupId);
    const rightPicker = page.getByRole('combobox', { name: 'Right workspace', exact: true });
    await expect(rightPicker.locator(`option[value="${leftCraft.selection.tabGroupId}"]`)).toHaveJSProperty('disabled', true);
    await rightPicker.selectOption(rightCraft.selection.tabGroupId);
    await expect(page.getByTestId('inline-vk-agent-chat')).toHaveCount(2, { timeout: 60_000 });

    const left = page.getByRole('region', { name: 'Left Agent pane', exact: true });
    const right = page.getByRole('region', { name: 'Right Agent pane', exact: true });
    const composer = (pane: typeof left) => pane.getByRole('textbox', { name: /Follow up|Markdown editor/ }).last();
    await expect(left).toContainText('History for session-1');
    await expect(right).toContainText('History for session-3');
    await composer(left).fill('Work in workspace one');
    await composer(right).fill('Work in workspace two');
    await left.getByRole('button', { name: 'Send', exact: true }).click();
    await right.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => backend.requests.filter((item) => item.path.endsWith('/follow-up'))
      .map((item) => [item.path, item.body.prompt]))
      .toEqual([
        ['/api/sessions/session-1/follow-up', 'Work in workspace one'],
        ['/api/sessions/session-3/follow-up', 'Work in workspace two'],
      ]);
    await expect(left).toContainText('Received: Work in workspace one');
    await expect(right).toContainText('Received: Work in workspace two');
    await expect(left).not.toContainText('Received: Work in workspace two');
    await expect(right).not.toContainText('Received: Work in workspace one');
    backend.setDiff('workspace-1', 'left.txt', 7);
    backend.setDiff('workspace-2', 'right.txt', 19);
    await expect(left).toContainText('+7');
    await expect(right).toContainText('+19');

    await composer(left).fill('Left workspace draft');
    await composer(right).fill('Right workspace draft');
    await left.getByRole('button', { name: 'session-1', exact: true }).click();
    await page.getByRole('menuitem', { name: /session-2$/ }).click();
    await expect(left).toContainText('History for session-2');
    await expect(composer(right)).toHaveText('Right workspace draft');
    await left.getByRole('button', { name: 'session-2', exact: true }).click();
    await page.getByRole('menuitem', { name: /session-1$/ }).click();
    await expect(composer(left)).toHaveText('Left workspace draft');

    const leftPicker = page.getByRole('combobox', { name: 'Left workspace', exact: true });
    await leftPicker.selectOption('');
    await expect(left).toContainText('Choose a workspace above');
    await expect(composer(right)).toHaveText('Right workspace draft');
    await expect(right).toContainText('+19');
    await leftPicker.selectOption(leftCraft.selection.tabGroupId);
    await expect(composer(left)).toHaveText('Left workspace draft');

    const handle = await page.getByRole('separator', { name: 'Resize workspace panes' }).boundingBox();
    if (!handle) throw new Error('Missing split resize handle');
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + 90, handle.y + handle.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => Number(new URL(page.url()).searchParams.get('size'))).toBeGreaterThan(50);
    const size = new URL(page.url()).searchParams.get('size');
    await expect.poll(() => [...backend.scratches.values()].map((scratch) => scratch.payload.data.message).sort())
      .toEqual(['Left workspace draft', 'Right workspace draft']);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(composer(left)).toHaveText('Left workspace draft');
    await expect(composer(right)).toHaveText('Right workspace draft');
    expect(new URL(page.url()).searchParams.get('size')).toBe(size);
    await expect(rightPicker).toHaveValue(rightCraft.selection.tabGroupId);

    const splitUrl = new URL(page.url());
    splitUrl.searchParams.set('left', 'missing-craft');
    await page.goto(splitUrl.toString(), { waitUntil: 'domcontentloaded' });
    await expect(left).toContainText('This craft is no longer available');
    await expect(composer(right)).toHaveText('Right workspace draft');
    await page.getByRole('link', { name: 'Back to dashboard', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Open Split Left Craft in / }).first()).toBeVisible();
    expect(backend.unexpected).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    for (const craft of created) {
      await request.post('/rpc/deleteSavedSession', {
        timeout: 5000,
        data: { jsonrpc: '2.0', id: 1, method: 'engine|module|workspace|action|deleteSavedSession', params: { id: craft.savedSession.id } },
      }).catch(() => {});
      await request.post('/rpc/deleteTabGroup', {
        timeout: 5000,
        data: { jsonrpc: '2.0', id: 2, method: 'engine|module|workspace|action|deleteTabGroup', params: craft.selection },
      }).catch(() => {});
    }
  }
});
