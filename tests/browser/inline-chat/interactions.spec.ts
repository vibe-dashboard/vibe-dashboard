import { expect, test } from './backend';

test('model and permission selections are sent with the intended session', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  const left = page.getByRole('region', { name: 'Left Agent' });
  await left.getByRole('button', { name: 'Model A', exact: true }).click();
  await page.getByText('Model B', { exact: true }).click();
  await page.getByRole('button', { name: 'Low', exact: true }).click();
  await page.getByRole('menuitem', { name: 'High', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(
    left.getByRole('button', { name: 'Model B · High', exact: true }),
  ).toBeVisible();
  await left.getByRole('button', { name: 'Permissions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Plan', exact: true }).click();
  await left
    .getByRole('textbox', { name: /Follow up|Markdown editor/ })
    .last()
    .fill('Use the selected model');
  await left.getByRole('button', { name: 'Send', exact: true }).click();
  await expect
    .poll(
      () =>
        backend.requests.find(
          (request) => request.path === '/api/sessions/session-1/follow-up',
        )?.body,
    )
    .toMatchObject({
      prompt: 'Use the selected model',
      executor_config: {
        executor: 'OPENCODE',
        model_id: 'model-b',
        permission_policy: 'PLAN',
        reasoning_id: 'high',
      },
    });
});

test('an uploaded attachment is delivered in the follow-up prompt', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  const left = page.getByRole('region', { name: 'Left Agent' });
  await left
    .getByRole('textbox', { name: /Follow up|Markdown editor/ })
    .last()
    .fill('Read this file');
  const chooser = page.waitForEvent('filechooser');
  await left.getByRole('button', { name: 'Attach file' }).click();
  await (
    await chooser
  ).setFiles({
    name: 'proof.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('proof'),
  });
  await expect(left).toContainText('proof.txt');
  await left.getByRole('button', { name: 'Send', exact: true }).click();
  await expect
    .poll(
      () =>
        backend.requests.find((request) => request.path.endsWith('/follow-up'))
          ?.body.prompt,
    )
    .toContain('.alohak-attachments/proof.txt');
  const prompt = backend.requests.find((request) =>
    request.path.endsWith('/follow-up'),
  )?.body.prompt;
  expect(prompt).toContain('stored in `.alohak-attachments/`');
  expect(prompt).toContain('Open the linked attachment paths');
});

test('workspace tasks show counts and housekeeping reaches the chosen session', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  const left = page.getByRole('region', { name: 'Left Agent' });
  await left.getByRole('button', { name: 'Workspace tasks' }).click();
  await expect(page.getByText('1 in progress', { exact: true })).toBeVisible();
  await expect(
    page.getByText('task-active · Active task', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('task-open · Open task', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('task-done · Done task', { exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole('link', { name: /form/i }).first(),
  ).toHaveAttribute('href', /task-active/);
  await page.getByLabel('Housekeeping session').selectOption('session-2');
  await page
    .getByRole('button', { name: 'Request housekeeping', exact: true })
    .click();
  await expect
    .poll(
      () =>
        backend.requests.find(
          (request) => request.path === '/api/sessions/session-2/follow-up',
        )?.body.prompt,
    )
    .toBe("Please do housekeeping on this workspace's beads");
});

test('running execution supports queue, cancellation and stop', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  const left = page.getByRole('region', { name: 'Left Agent' });
  await expect(left).toContainText('History for session-1');
  backend.stream('session-1', 'Executing');
  await expect(left).toContainText('Executing');
  await left
    .getByRole('textbox', { name: /Follow up|Markdown editor/ })
    .last()
    .fill('Run this next');
  await left.getByRole('button', { name: 'Queue', exact: true }).click();
  await expect
    .poll(() =>
      backend.requests.some(
        (request) =>
          request.path === '/api/sessions/session-1/queue' &&
          request.method === 'POST',
      ),
    )
    .toBe(true);
  await left.getByRole('button', { name: /Cancel.*queue/i }).click();
  await expect
    .poll(() =>
      backend.requests.some(
        (request) =>
          request.path.endsWith('/queue') && request.method === 'DELETE',
      ),
    )
    .toBe(true);
  await left.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect
    .poll(() =>
      backend.requests.some((request) => request.path.endsWith('/stop')),
    )
    .toBe(true);
});

test('a new session is created without switching the other pane', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  const left = page.getByRole('region', { name: 'Left Agent' });
  const right = page.getByRole('region', { name: 'Right Agent' });
  await left.getByRole('button', { name: 'session-1', exact: true }).click();
  await page
    .getByRole('menuitem', { name: 'New Session', exact: true })
    .click();
  await left
    .getByRole('textbox', { name: /Follow up|Markdown editor/ })
    .last()
    .fill('A new session prompt');
  await left.getByRole('button', { name: 'Send', exact: true }).click();
  await expect
    .poll(() =>
      backend.requests.some(
        (request) =>
          request.path === '/api/sessions' && request.method === 'POST',
      ),
    )
    .toBe(true);
  await expect(left).toContainText('Received: A new session prompt');
  await expect(
    right.getByRole('button', { name: 'session-1', exact: true }),
  ).toBeVisible();
});

test('context usage reflects streamed token usage', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  const left = page.getByRole('region', { name: 'Left Agent' });
  await expect(left).toContainText('History for session-1');
  backend.stream('session-1', 'Using context');
  await expect(left).toContainText('Using context');
  backend.append(
    'session-1',
    backend.entry('', {
      type: 'token_usage_info',
      total_tokens: 2500,
      model_context_window: 10000,
    }),
  );
  await expect(left.getByRole('img', { name: /25%/ })).toBeVisible();
});

test('approval response resumes the intended execution', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  const left = page.getByRole('region', { name: 'Left Agent' });
  await expect(left).toContainText('History for session-1');
  backend.stream('session-1', 'Waiting for approval');
  await expect(left).toContainText('Waiting for approval');
  backend.approval('session-1');
  await left.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect
    .poll(
      () =>
        backend.requests.find(
          (request) =>
            request.path === '/api/approvals/approval-session-1/respond',
        )?.body,
    )
    .toMatchObject({
      execution_process_id: 'process-session-1',
      status: { status: 'approved' },
    });
  await expect(left).toContainText('Approval response received');
});

test('question answer is delivered to its pending execution', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  const left = page.getByRole('region', { name: 'Left Agent' });
  await expect(left).toContainText('History for session-1');
  backend.stream('session-1', 'Waiting for answer');
  await expect(left).toContainText('Waiting for answer');
  backend.approval('session-1', true);
  await left.getByRole('button', { name: 'Left', exact: true }).click();
  await expect
    .poll(
      () =>
        backend.requests.find(
          (request) =>
            request.path === '/api/approvals/approval-session-1/respond',
        )?.body,
    )
    .toMatchObject({
      execution_process_id: 'process-session-1',
      status: {
        status: 'answered',
        answers: [{ question: 'Which direction?', answer: ['Left'] }],
      },
    });
  await expect(left).toContainText('Approval response received');
});

test('preview menu opens the canonical URL and delegates configuration to its host', async ({
  page,
}) => {
  await page.goto('/');
  const left = page.getByRole('region', { name: 'Left Agent' });
  await left.getByRole('button', { name: 'Preview slots' }).click();
  await expect(
    left.getByRole('menuitem', { name: /Disabled preview/ }),
  ).toHaveCount(0);
  const triggerBox = await left.getByRole('button', { name: 'Preview slots' }).boundingBox();
  const menuBox = await left.getByRole('menu').boundingBox();
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(triggerBox!.y);
  const popup = page.waitForEvent('popup');
  await left.getByRole('menuitem', { name: /^Application preview/ }).click();
  const preview = await popup;
  await expect(preview).toHaveURL(
    'http://127.0.0.1:5189/preview.html?slot=slot-1',
  );
  await expect(
    preview.getByRole('heading', { name: 'Preview response' }),
  ).toBeVisible();
  await preview.close();
  await left.getByRole('menuitem', { name: 'Configure preview slots' }).click();
  await expect(
    page.getByText('Configure requested for workspace-1'),
  ).toBeVisible();
});

test('Create Workspace keeps preset selection without an unsupported settings action', async ({
  page,
}) => {
  await page.goto('/?create');
  await page.getByRole('button', { name: 'Recent', exact: true }).click();
  await page.getByText('repo', { exact: true }).click();
  await page.getByRole('option', { name: /main/ }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Custom', exact: true }).click();
  await expect(
    page.getByRole('menuitem', { name: 'Default', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('menuitem', { name: 'Custom', exact: true }),
  ).toHaveCount(0);
});
