import type { Page, Route, WebSocketRoute } from 'playwright/test';
import { test as base, expect } from 'playwright/test';
import { readFileSync } from 'node:fs';

const seedConfig = JSON.parse(
  readFileSync(
    new URL(
      '../../e2e/fixtures/vk-mocked-sandbox/basic-seeded/vk/dev_assets/config.json',
      import.meta.url,
    ),
    'utf8',
  ),
);

const now = '2026-10-21T00:00:00Z';
const opencode = {
  append_prompt: null,
  model: 'model-a',
  auto_approve: false,
  auto_compact: true,
};
export const executorConfig = { executor: 'OPENCODE', variant: 'DEFAULT' };
const repository = {
  id: 'repo-1', path: '/repo', name: 'repo', display_name: 'repo',
  target_branch: 'main', dev_server_scripts: [], default_target_branch: 'main',
  parallel_setup_script: false, created_at: now, updated_at: now,
};

export function session(id: string, workspace = 'workspace-1') {
  return {
    id,
    workspace_id: workspace,
    name: id,
    executor: 'OPENCODE',
    agent_working_dir: '/repo',
    context_reset_execution_process_id: null,
    created_at: now,
    updated_at: now,
  };
}

export const test = base.extend<{ backend: InlineChatBackend }>({
  backend: [
    async ({ page }, use) => {
      const backend = new InlineChatBackend();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await backend.install(page);
      await use(backend);
      expect(errors, 'Uncaught browser errors').toEqual([]);
      expect(backend.unexpected, 'Unmodelled API calls').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

export class InlineChatBackend {
  attachmentName = 'proof.txt';
  attachmentDirectory = '.alohak-attachments';
  attachmentMime = 'text/plain';
  discoveryDelayMs = 0;
  metadataDelayMs = 0;
  discoveryError: string | null = null;
  discoveryModelAName = 'Model A';
  discoveryConnections: string[] = [];
  previewCommand = 'npm run preview';
  previewSlotDeleted = false;
  previewConfigDeleted = false;
  previewRestarts = 0;
  requests: Array<{ path: string; method: string; body: any }> = [];
  unexpected: string[] = [];
  scratches = new Map<
    string,
    { id: string; payload: any; created_at: string; updated_at: string }
  >();
  sessions = [
    session('session-1'),
    session('session-2'),
    session('session-3', 'workspace-2'),
  ];
  private sockets = new Map<string, Set<WebSocketRoute>>();
  activeSocketCount(path: string) {
    return [...this.sockets.entries()].reduce((count, [url, sockets]) =>
      count + (url.split('?')[0] === path ? sockets.size : 0), 0);
  }
  private processes = new Map<
    string,
    Record<string, unknown> & { id: string; session_id: string; status: string }
  >();
  private logs = new Map<string, unknown[]>();
  private queues = new Map<string, unknown>();
  private approvals: Record<
    string,
    {
      approval_id: string;
      tool_name: string;
      execution_process_id: string;
      is_question: boolean;
      created_at: string;
      timeout_at: string;
    }
  > = {};
  tasks = {
    workspaceId: 'workspace-1',
    dir: '/repo',
    initialized: true,
    groups: {
      open: [
        {
          id: 'task-open',
          title: 'Open task',
          status: 'open',
          statusBucket: 'open',
          labels: [],
          forms: {
            hasForms: false,
            hasPendingAnswer: false,
            pendingResponseCount: 0,
            formIds: [],
            pendingFormIds: [],
          },
        },
      ],
      inProgress: [
        {
          id: 'task-active',
          title: 'Active task',
          status: 'in_progress',
          statusBucket: 'inProgress',
          labels: [],
          forms: {
            hasForms: true,
            hasPendingAnswer: true,
            pendingResponseCount: 1,
            formIds: ['review'],
            pendingFormIds: ['review'],
          },
        },
      ],
      done: [
        {
          id: 'task-done',
          title: 'Done task',
          status: 'closed',
          statusBucket: 'done',
          labels: [],
          forms: {
            hasForms: false,
            hasPendingAnswer: false,
            pendingResponseCount: 0,
            formIds: [],
            pendingFormIds: [],
          },
        },
      ],
    },
    counts: { open: 1, inProgress: 1, done: 1 },
    updateStrategy: { intervalMs: 20000 },
  };

  constructor() {
    for (const session of this.sessions) {
      const process = this.stream(session.id, `History for ${session.id}`);
      this.processes.set(session.id, {
        ...process,
        status: 'completed',
        completed_at: now,
      });
    }
  }

  async install(page: Page) {
    await page.route('**/agents/*.svg', (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg"/>',
      }),
    );
    await page.route(
      (url) => url.pathname.startsWith('/api/'),
      (route) => this.http(route),
    );
    await page.route('**/dashboard/api/**', (route) => this.http(route));
    await page.route('**/internal/preview/**', (route) => this.http(route));
    await page.routeWebSocket(/\/api\//, async (socket) => {
      const url = new URL(socket.url());
      const key = url.pathname + url.search;
      const sockets = this.sockets.get(key) ?? new Set();
      sockets.add(socket);
      this.sockets.set(key, sockets);
      socket.onClose(() => sockets.delete(socket));
      if (
        this.metadataDelayMs &&
        (url.pathname.startsWith('/api/scratch/') ||
          url.pathname.includes('/stream/session/'))
      ) {
        await new Promise((resolve) =>
          setTimeout(resolve, this.metadataDelayMs),
        );
        if (!sockets.has(socket)) return;
      }
      if (url.pathname.includes('discovered-options')) {
        this.discoveryConnections.push(key);
        const publish = () => {
          if (!sockets.has(socket)) return;
          this.patch(socket, '/options', {
            model_selector: {
              providers: [],
              models: [
                {
                  id: 'model-a',
                  name: this.discoveryModelAName,
                  reasoning_options: [],
                },
                {
                  id: 'model-b',
                  name: 'Model B',
                  reasoning_options: [
                    { id: 'low', label: 'Low', is_default: true },
                    { id: 'high', label: 'High', is_default: false },
                  ],
                },
              ],
              default_model: 'model-a',
              agents: [],
              permissions: ['AUTO', 'SUPERVISED', 'PLAN'],
            },
            slash_commands: [],
            loading_models: false,
            loading_agents: false,
            loading_slash_commands: false,
            error: this.discoveryError,
          });
        };
        if (this.discoveryDelayMs) setTimeout(publish, this.discoveryDelayMs);
        else publish();
      } else if (url.pathname.startsWith('/api/scratch/')) {
        const path = url.pathname.replace(/\/stream\/ws$/, '');
        this.patch(socket, '/scratch', this.scratches.get(path) ?? null);
      } else if (url.pathname.includes('/stream/session/')) {
        const process = this.processes.get(
          url.searchParams.get('session_id') ?? '',
        );
        this.patch(
          socket,
          '/execution_processes',
          process ? { [process.id]: process } : {},
        );
      } else if (url.pathname.includes('/normalized-logs/')) {
        const processId = url.pathname.split('/')[3] ?? '';
        this.patch(socket, '/entries', this.logs.get(processId) ?? []);
        const process = [...this.processes.values()].find(
          (entry) => entry.id === processId,
        );
        if (process?.status !== 'running')
          socket.send(JSON.stringify({ finished: true }));
      } else if (url.pathname.includes('/raw-logs/')) {
        socket.send(
          JSON.stringify({
            JsonPatch: [
              {
                op: 'add',
                path: '/entries/0',
                value: {
                  type: 'STDOUT',
                  content: 'Preview server listening\n',
                },
              },
              {
                op: 'add',
                path: '/entries/1',
                value: { type: 'STDERR', content: 'Preview warning\n' },
              },
            ],
          }),
        );
      } else if (url.pathname.includes('/git/diff/')) {
        this.patch(socket, '/entries', {});
      } else if (url.pathname === '/api/approvals/stream/ws') {
        this.patch(socket, '/pending', this.approvals);
      }
      socket.send(JSON.stringify({ Ready: true }));
    });
  }

  private patch(socket: WebSocketRoute, path: string, value: unknown) {
    socket.send(
      JSON.stringify({ JsonPatch: [{ op: 'replace', path, value }] }),
    );
  }

  stream(
    sessionId: string,
    message: string,
    config: typeof executorConfig & {
      model_id?: string;
      reasoning_id?: string;
    } = executorConfig,
  ) {
    const process = {
      id: `process-${sessionId}`,
      session_id: sessionId,
      run_reason: 'codingagent',
      executor_action: {
        typ: {
          type: 'CodingAgentInitialRequest',
          prompt: 'Initial prompt',
          executor_config: config,
          working_dir: null,
        },
        next_action: null,
      },
      status: 'running',
      exit_code: null,
      dropped: false,
      created_at: now,
      updated_at: now,
      started_at: now,
      completed_at: null,
    };
    this.logs.set(process.id, [this.entry(message)]);
    this.processes.set(sessionId, process);
    for (const [key, sockets] of this.sockets) {
      if (
        key.includes('/stream/session/') &&
        new URL(`http://test${key}`).searchParams.get('session_id') ===
          sessionId
      ) {
        for (const socket of sockets)
          this.patch(socket, '/execution_processes', { [process.id]: process });
      }
    }
    return process;
  }

  entry(content: string, entryType: object = { type: 'assistant_message' }) {
    return {
      type: 'NORMALIZED_ENTRY',
      content: { timestamp: now, content, entry_type: entryType },
    };
  }

  append(sessionId: string, entry: unknown) {
    const processId = `process-${sessionId}`;
    const entries = [...(this.logs.get(processId) ?? []), entry];
    this.logs.set(processId, entries);
    for (const [key, sockets] of this.sockets) {
      if (key.includes(`/execution-processes/${processId}/normalized-logs/`)) {
        for (const socket of sockets) this.patch(socket, '/entries', entries);
      }
    }
  }

  setDiff(workspaceId: string, filename: string, additions: number) {
    for (const [key, sockets] of this.sockets) {
      if (key.includes(`/workspaces/${workspaceId}/git/diff/`)) {
        for (const socket of sockets)
          this.patch(socket, '/entries', {
            repo: {
              [filename]: {
                type: 'DIFF',
                content: {
                  change: 'modified',
                  oldPath: filename,
                  newPath: filename,
                  oldContent: '',
                  newContent: 'new',
                  additions,
                  deletions: 0,
                  contentOmitted: true,
                  repoId: 'repo-1',
                },
              },
            },
          });
      }
    }
  }

  finish(sessionId: string) {
    const process = this.processes.get(sessionId);
    if (!process) throw new Error(`No execution for ${sessionId}`);
    process.status = 'killed';
    for (const [key, sockets] of this.sockets) {
      if (
        key.includes('/stream/session/') &&
        new URL(`http://test${key}`).searchParams.get('session_id') ===
          sessionId
      ) {
        for (const socket of sockets)
          this.patch(socket, '/execution_processes', { [process.id]: process });
      }
      if (key.includes(`/execution-processes/${process.id}/normalized-logs/`)) {
        for (const socket of sockets)
          socket.send(JSON.stringify({ finished: true }));
      }
    }
  }

  approval(sessionId: string, question = false) {
    const id = `approval-${sessionId}`;
    this.approvals[id] = {
      approval_id: id,
      tool_name: question ? 'ask_user_question' : 'run_command',
      execution_process_id: `process-${sessionId}`,
      is_question: question,
      created_at: new Date().toISOString(),
      timeout_at: new Date(Date.now() + 60_000).toISOString(),
    };
    this.append(
      sessionId,
      this.entry(question ? 'Choose a direction' : 'Run a test command', {
        type: 'tool_use',
        tool_name: question ? 'ask_user_question' : 'run_command',
        action_type: question
          ? {
              action: 'ask_user_question',
              questions: [
                {
                  question: 'Which direction?',
                  header: 'Direction',
                  options: [
                    { label: 'Left', description: 'Choose left' },
                    { label: 'Right', description: 'Choose right' },
                  ],
                  multiSelect: false,
                },
              ],
            }
          : {
              action: 'command_run',
              command: 'true',
              result: null,
              category: 'other',
            },
        status: { status: 'pending_approval', approval_id: id },
      }),
    );
    this.broadcastApprovals();
  }

  private broadcastApprovals() {
    for (const [key, sockets] of this.sockets) {
      if (key === '/api/approvals/stream/ws')
        for (const socket of sockets)
          this.patch(socket, '/pending', this.approvals);
    }
  }

  private async http(route: Route) {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const entityId = path.split('/')[3] ?? '';
    const method = request.method();
    const body =
      request.headers()['content-type']?.includes('application/json') &&
      request.postData()
        ? request.postDataJSON()
        : null;
    this.requests.push({ path, method, body });
    const reply = (data: unknown) =>
      route.fulfill({
        json: { success: true, data, error_data: null, message: null },
      });
    if (path.endsWith('/preview-slots/slot-1/script') && method === 'PUT') {
      this.previewCommand = body.command;
      return route.fulfill({ json: { command: this.previewCommand } });
    }
    if (path.endsWith('/preview-slots/slot-1') && method === 'DELETE') {
      this.previewSlotDeleted = true;
      return route.fulfill({ json: { deleted: true } });
    }
    if (path.endsWith('/run-configs/run-1') && method === 'DELETE') {
      if (!this.previewSlotDeleted)
        return route.fulfill({
          status: 400,
          json: {
            message:
              'Delete linked preview slots before deleting this run config.',
          },
        });
      this.previewConfigDeleted = true;
      return route.fulfill({ json: { deleted: true } });
    }
    if (path.endsWith('/preview-slots/slot-1/restart')) {
      this.previewRestarts++;
      return route.fulfill({
        json: {
          execution_process: { id: `preview-process-${this.previewRestarts}` },
        },
      });
    }
    if (path.endsWith('/preview-slots/slot-1/process')) {
      return route.fulfill({
        json: {
          processId: `preview-process-${this.previewRestarts}`,
          message: null,
        },
      });
    }
    if (path.endsWith('/run-configs'))
      return route.fulfill({
        json: {
          run_configs: this.previewConfigDeleted
            ? []
            : [
                {
                  id: 'run-1',
                  repo_id: 'repo-1',
                  slug: 'app',
                  name: 'Application',
                  command: this.previewCommand,
                  kind: 'long_running',
                  enabled: true,
                },
              ],
          preview_urls: {
            'slot-1': 'http://127.0.0.1:5189/preview.html?slot=slot-1',
          },
          preview_slots: [
            {
              id: 'slot-1',
              workspace_id: 'workspace-1',
              repo_id: 'repo-1',
              run_config_id: 'run-1',
              title: 'Application preview',
              slot_slug: 'app',
              enabled: true,
            },
            { id: 'disabled-slot', title: 'Disabled preview', enabled: false },
          ].filter((slot) => !this.previewSlotDeleted || slot.id !== 'slot-1'),
        },
      });
    if (path === '/api/profiles') return reply(body ?? {});
    if (path.endsWith('/git/status')) return reply([]);
    if (path.endsWith('/branches'))
      return reply([{ name: 'main', is_current: true, is_remote: false }]);
    if (/^\/api\/workspaces\/[^/]+\/conversation-preview$/.test(path))
      return reply({
        workspace_id: path.split('/')[3],
        session_id: null,
        messages: [],
        has_running_turn: false,
        source: 'cache',
        warmed_at: now,
      });
    if (path === '/api/config' && method === 'PUT') return reply(body);
    if (path === '/api/info' || path === '/api/config')
      return reply({
        config: {
          ...seedConfig,
          executor_profile: executorConfig,
          disclaimer_acknowledged: true,
          onboarding_acknowledged: true,
        },
        version: 'test',
        environment: {
          os_type: 'linux',
          os_version: '',
          os_architecture: 'x86_64',
          bitness: '64',
        },
        machine_id: 'harness',
        login_status: { status: 'loggedout' },
        executors: { OPENCODE: { DEFAULT: { OPENCODE: opencode } } },
        capabilities: { OPENCODE: ['CONTEXT_USAGE'] },
      });
    if (path === '/api/sessions' && method === 'GET')
      return reply(
        this.sessions.filter(
          (entry) =>
            entry.workspace_id === url.searchParams.get('workspace_id'),
        ),
      );
    if (path === '/api/sessions' && method === 'POST') {
      const created = session(
        `session-${this.sessions.length + 1}`,
        body.workspace_id,
      );
      this.sessions.push(created);
      return reply(created);
    }
    if (path.endsWith('/follow-up') && method === 'POST') {
      return reply(this.stream(entityId, `Received: ${body.prompt}`));
    }
    if (/^\/api\/approvals\/[^/]+\/respond$/.test(path)) {
      const id = entityId;
      const approval = this.approvals[id];
      if (!approval) throw new Error(`Unknown approval ${id}`);
      delete this.approvals[id];
      this.broadcastApprovals();
      const process = [...this.processes.values()].find(
        (entry) => entry.id === approval.execution_process_id,
      );
      if (process)
        this.append(
          process.session_id,
          this.entry('Approval response received'),
        );
      return reply(body.status);
    }
    if (path.endsWith('/execution/stop')) {
      this.finish(entityId);
      return reply(null);
    }
    if (/^\/api\/execution-processes\/[^/]+\/stop$/.test(path)) {
      const process = [...this.processes.values()].find(
        (item) => item.id === path.split('/')[3],
      );
      if (process) this.finish(process.session_id);
      return reply(null);
    }
    if (/^\/api\/sessions\/[^/]+\/queue$/.test(path)) {
      const id = entityId;
      if (method === 'POST')
        this.queues.set(id, {
          status: 'queued',
          message: { session_id: id, data: body, queued_at: now },
        });
      if (method === 'DELETE') this.queues.delete(id);
      return reply(this.queues.get(id) ?? { status: 'empty' });
    }
    if (path.endsWith('/attachments/upload'))
      return reply({
        id: 'attachment-1',
        file_path: `${this.attachmentDirectory}/${this.attachmentName}`,
        original_name: this.attachmentName,
        mime_type: this.attachmentMime,
        size_bytes: 5,
        hash: 'test',
        created_at: now,
        updated_at: now,
      });
    if (path.includes('/attachments/') && path.endsWith('/metadata'))
      return reply({
        exists: true,
        file_name: this.attachmentName,
        path: `${this.attachmentDirectory}/${this.attachmentName}`,
        size_bytes: 5,
        format: this.attachmentName.split('.').pop(),
        proxy_url: '/api/attachments/attachment-1/file',
      });
    if (path.match(/^\/api\/sessions\/[^/]+\/conversation-preview$/)) {
      const id = path.split('/')[3];
      return reply({
        workspace_id: this.sessions.find((entry) => entry.id === id)
          ?.workspace_id,
        session_id: id,
        messages: [
          {
            role: 'assistant',
            content: `History for ${id}`,
            execution_process_id: `process-${id}`,
            created_at: now,
          },
        ],
        has_running_turn: false,
        source: 'cache',
        warmed_at: now,
      });
    }
    if (path.match(/^\/api\/workspaces\/[^/]+$/)) {
      return reply({
        id: path.split('/')[3],
        task_id: null,
        container_ref: '/repo',
        branch: 'test',
        name: 'Harness workspace',
        archived: false,
        pinned: false,
        worktree_deleted: false,
        setup_completed_at: now,
        created_at: now,
        updated_at: now,
      });
    }
    if (
      path.endsWith('/repos') ||
      path === '/api/repos' ||
      path === '/api/repos/recent'
    )
      return reply([repository]);
    if (path === '/api/repos/repo-1') return reply(repository);
    if (path.endsWith('/beads/tasks'))
      return route.fulfill({ json: this.tasks });
    if (path.startsWith('/api/scratch/')) {
      const id = path.split('/')[4] ?? '';
      if (
        !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)
      ) {
        this.unexpected.push(`Invalid scratch UUID: ${id}`);
        return route.fulfill({ status: 400, json: { success: false } });
      }
      if (method === 'PUT' || method === 'POST') {
        this.scratches.set(path, {
          id,
          payload: body.payload,
          created_at: now,
          updated_at: now,
        });
      } else if (method === 'DELETE') {
        this.scratches.delete(path);
      }
      if (method !== 'GET') {
        for (const [key, sockets] of this.sockets) {
          if (key === `${path}/stream/ws`) {
            for (const socket of sockets)
              this.patch(socket, '/scratch', this.scratches.get(path) ?? null);
          }
        }
      }
      return reply(
        method === 'DELETE' ? null : (this.scratches.get(path) ?? null),
      );
    }
    if (path.includes('/queue')) return reply({ status: 'empty' });
    if (path.includes('/branch-status')) return reply([]);
    if (path.includes('/preset-options')) return reply({});
    if (path.includes('/availability')) return reply({ type: 'INSTALLED' });
    if (path.includes('/attachments')) return reply([]);
    this.unexpected.push(`${method} ${path}${url.search}`);
    return route.fulfill({
      status: 501,
      json: { success: false, message: 'API fixture not implemented' },
    });
  }
}
