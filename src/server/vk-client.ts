import type {
  WorkspaceSummary,
  WorkspaceSummaryResponse,
} from '../../vibe-kanban/shared/types';

export type {
  WorkspaceSummary,
  WorkspaceSummaryResponse,
} from '../../vibe-kanban/shared/types';

export type Executor =
  | 'CLAUDE_CODE'
  | 'CODEX'
  | 'GEMINI'
  | 'AMP'
  | 'CURSOR_AGENT'
  | 'COPILOT'
  | 'DROID'
  | 'OPENCODE'
  | 'QWEN_CODE';

export interface Workspace {
  id: string;
  task_id: string | null;
  container_ref: string | null;
  branch: string;
  agent_working_dir: string | null;
  created_at: string;
  updated_at: string;
  archived: boolean;
  pinned: boolean;
  name: string | null;
}

export interface Repo {
  id: string;
  path: string;
  name: string;
  display_name: string;
  default_target_branch?: string | null;
}

export interface RepoWithBranch {
  id: string;
  name: string;
  display_name: string;
  target_branch: string;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  is_directory: boolean;
  is_git_repo: boolean;
  last_modified: string | null;
}

export interface DirectoryListResponse {
  entries: DirectoryEntry[];
  current_path: string;
}

export interface GitBranch {
  name: string;
  is_current: boolean;
  is_remote: boolean;
  last_commit_date: string | null;
}

export interface ExecutorConfig {
  executor: Executor;
  variant?: string | null;
  model_id?: string | null;
  agent_id?: string | null;
  reasoning_id?: string | null;
  permission_policy?: string | null;
}

export interface UserSystemInfo {
  config?: { executor_profile?: ExecutorConfig | null };
  executors?: Partial<Record<Executor, unknown>>;
}

export interface CreateAndStartWorkspaceRequest {
  name: string | null;
  repos: Array<{ repo_id: string; target_branch: string }>;
  linked_issue: { remote_project_id: string; issue_id: string } | null;
  executor_config: ExecutorConfig;
  prompt: string;
  attachment_ids: string[] | null;
}

export interface CreateAndStartWorkspaceResponse {
  workspace: Workspace;
  execution_process: ExecutionProcess;
}

export interface CreateOnlyWorkspaceRequest {
  name: string | null;
  repos: Array<{ repo_id: string; target_branch: string }>;
  linked_issue: { remote_project_id: string; issue_id: string } | null;
  attachment_ids: string[] | null;
}

export interface CreateOnlyWorkspaceResponse {
  workspace: Workspace;
}

export interface Session {
  id: string;
  workspace_id: string;
  executor: Executor;
  created_at: string;
  updated_at: string;
}

export interface ExecutionProcess {
  id: string;
  session_id: string;
  status: 'running' | 'completed' | 'failed' | 'killed';
  created_at?: string;
  started_at?: string;
  completed_at?: string | null;
  updated_at?: string;
  exit_code?: number | null;
  dropped?: boolean;
  run_reason?: string;
  executor_action?: unknown;
}

export interface RawLogEntry {
  type: 'STDOUT' | 'STDERR';
  content: string;
}

export interface PreviewResolveRequest {
  host: string;
  workspaceToken: string;
  repoSlug: string;
  slotSlug: string;
  customerSlug: string;
  ensure: boolean;
  method: string;
  path: string;
  includeLogs?: boolean;
}

export interface PreviewResolveResponse {
  status: 'ready' | 'redirect' | 'starting' | 'not_found' | 'capacity_full' | 'failed' | 'unavailable' | 'error';
  location?: string | null;
  upstream?: string | null;
  message?: string | null;
  executionProcessId?: string | null;
  workspaceId?: string | null;
  previewSlotId?: string | null;
  logs?: RawLogEntry[];
}

export type RunConfigKind = 'long_running' | 'one_shot' | 'test';

export interface RunConfig {
  id: string;
  repo_id: string;
  slug: string;
  name: string;
  description?: string | null;
  command: string;
  working_dir?: string | null;
  kind: RunConfigKind;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface UpsertRunConfig {
  id?: string | null;
  repo_id: string;
  slug: string;
  name: string;
  description?: string | null;
  command: string;
  working_dir?: string | null;
  kind: RunConfigKind;
  enabled?: boolean;
}

export interface PreviewSlot {
  id: string;
  repo_id: string;
  run_config_id?: string | null;
  target: PreviewSlotTarget;
  slot_slug: string;
  title: string;
  description?: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface UpsertPreviewSlot {
  id?: string | null;
  repo_id: string;
  run_config_id?: string | null;
  target?: PreviewSlotTarget | null;
  slot_slug: string;
  title: string;
  description?: string | null;
  enabled?: boolean;
}

export type PreviewSlotTarget =
  | { type: 'local_run_config'; run_config_id: string }
  | {
    type: 'external_redirect';
    url_template: string;
    project_slug?: string | null;
    allowed_host_template: string;
  };

export interface ValidatePreviewSlotTargetResponse {
  valid: boolean;
  destination?: string | null;
  errors: string[];
}

export interface PreviewProcessLink {
  id: string;
  workspace_id: string;
  repo_id: string;
  run_config_id: string;
  preview_slot_id?: string | null;
  execution_process_id: string;
  assigned_port: number;
  status_snapshot: 'starting' | 'ready' | 'failed' | 'stopped';
  started_at: string;
  updated_at: string;
  ended_at?: string | null;
}

export interface RunConfigStartResponse {
  execution_process: ExecutionProcess;
  preview_process_link: PreviewProcessLink;
  upstream: string;
}

export interface PreviewSlotUrlParts {
  previewSlotId: string;
  workspaceToken: string;
  repoSlug: string;
  slotSlug: string;
}

export interface WorkspaceRunConfigsResponse {
  run_configs: RunConfig[];
  preview_slots: PreviewSlot[];
  preview_url_parts: PreviewSlotUrlParts[];
  preview_process_links?: PreviewProcessLink[];
}

export interface PreviewSlotUrlResponse extends PreviewSlotUrlParts {
  customerSlug?: string;
  host: string;
  url: string;
}

export interface CreateSessionBody {
  workspace_id: string;
  executor: Executor;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error_data?: unknown;
  message?: string | null;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type WebSocketLike = {
  close: () => void;
  addEventListener: (type: 'message' | 'error', listener: (event: { data?: unknown }) => void) => void;
};
type WebSocketFactory = (url: string) => WebSocketLike;

export interface VibeKanbanServerClientOptions {
  baseUrl?: string;
  fetch?: FetchLike;
  webSocketFactory?: WebSocketFactory;
}

export class VkApiError extends Error {
  readonly status?: number;
  readonly bodyText?: string;
  readonly errorData?: unknown;

  constructor(args: {
    message: string;
    status?: number;
    bodyText?: string;
    errorData?: unknown;
  }) {
    super(args.message);
    this.name = 'VkApiError';
    this.status = args.status;
    this.bodyText = args.bodyText;
    this.errorData = args.errorData;
  }
}

export function resolveVibeApiBaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const configured = env.VIBE_API_URL || env.VK_API_URL || 'http://localhost:3007';
  const withoutTrailingSlash = configured.replace(/\/+$/, '');
  if (withoutTrailingSlash.endsWith('/api')) {
    return withoutTrailingSlash;
  }
  return `${withoutTrailingSlash}/api`;
}

export class VibeKanbanServerClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly webSocketFactory?: WebSocketFactory;

  constructor(options: VibeKanbanServerClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? resolveVibeApiBaseUrl()).replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? fetch;
    this.webSocketFactory = options.webSocketFactory;
  }

  getWorkspaces(): Promise<Workspace[]> {
    return this.get('/workspaces');
  }

  getWorkspaceSummaries(archived = false): Promise<WorkspaceSummaryResponse> {
    return this.post('/workspaces/summaries', { archived });
  }

  getWorkspace(workspaceId: string): Promise<Workspace> {
    return this.get(`/workspaces/${encodeURIComponent(workspaceId)}`);
  }

  getWorkspaceRepos(workspaceId: string): Promise<RepoWithBranch[]> {
    return this.get(`/workspaces/${encodeURIComponent(workspaceId)}/repos`);
  }

  getSessions(workspaceId: string): Promise<Session[]> {
    return this.get(`/sessions?workspace_id=${encodeURIComponent(workspaceId)}`);
  }

  getSession(sessionId: string): Promise<Session> {
    return this.get(`/sessions/${encodeURIComponent(sessionId)}`);
  }

  createSession(body: CreateSessionBody): Promise<Session> {
    return this.post('/sessions', body);
  }

  getExecutionProcess(processId: string): Promise<ExecutionProcess> {
    return this.get(`/execution-processes/${encodeURIComponent(processId)}`);
  }

  async stopExecutionProcess(processId: string): Promise<void> {
    await this.post(`/execution-processes/${encodeURIComponent(processId)}/stop`, {});
  }

  async stopPreviewProcess(
    workspaceId: string,
    processId: string,
    options: { previewSlotId?: string | null } = {},
  ): Promise<void> {
    await this.post(
      `/workspaces/${encodeURIComponent(workspaceId)}/execution/preview-processes/${encodeURIComponent(processId)}/stop`,
      { previewSlotId: options.previewSlotId ?? null },
    );
  }

  fetchRawExecutionLogs(
    processId: string,
    options: { timeoutMs?: number; maxEntries?: number } = {},
  ): Promise<RawLogEntry[]> {
    const timeoutMs = clampInteger(options.timeoutMs ?? 1500, 100, 10_000);
    const maxEntries = clampInteger(options.maxEntries ?? 200, 1, 1_000);
    const webSocketFactory = this.webSocketFactory ?? defaultWebSocketFactory();
    const url = `${this.baseUrl.replace(/^http/i, 'ws')}/execution-processes/${encodeURIComponent(processId)}/raw-logs/ws`;

    return new Promise((resolve, reject) => {
      const logs: RawLogEntry[] = [];
      let retainedBytes = 0;
      const maxRetainedBytes = 64 * 1024;
      let settled = false;
      let ws: WebSocketLike | null = null;
      const finish = (result: RawLogEntry[]) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try {
          ws?.close();
        } catch {
          // Ignore close errors after the log request has already succeeded.
        }
        resolve(result);
      };
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try {
          ws?.close();
        } catch {
          // Ignore close errors while surfacing the original failure.
        }
        reject(error);
      };
      const timeout = setTimeout(() => finish(logs), timeoutMs);

      try {
        ws = webSocketFactory(url);
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
        return;
      }

      ws.addEventListener('message', (event) => {
        try {
          const message = JSON.parse(String(event.data ?? '{}')) as {
            JsonPatch?: Array<{ value?: { type?: unknown; content?: unknown } }>;
            Ready?: unknown;
            finished?: unknown;
          };
          for (const op of message.JsonPatch ?? []) {
            const value = op.value;
            if (
              (value?.type === 'STDOUT' || value?.type === 'STDERR') &&
              typeof value.content === 'string'
            ) {
              const content = value.content.slice(-(16 * 1024));
              const bytes = Buffer.byteLength(content);
              logs.push({ type: value.type, content });
              retainedBytes += bytes;
              while (logs.length > maxEntries || retainedBytes > maxRetainedBytes) {
                const removed = logs.shift();
                if (!removed) break;
                retainedBytes -= Buffer.byteLength(removed.content);
              }
            }
          }
          if (message.Ready !== undefined || message.finished === true) {
            finish(logs);
          }
        } catch (error) {
          fail(error);
        }
      });
      ws.addEventListener('error', (event) => {
        fail(new VkApiError({
          message: `VK execution log stream failed for process ${processId}`,
          errorData: event,
        }));
      });
    });
  }

  async checkHealth(): Promise<void> {
    await this.get('/health');
  }

  getInfo(): Promise<UserSystemInfo> {
    return this.get('/info');
  }

  listRepos(): Promise<Repo[]> {
    return this.get('/repos');
  }

  registerRepo(body: { path: string; display_name?: string }): Promise<Repo> {
    return this.post('/repos', body);
  }

  listDirectory(path: string): Promise<DirectoryListResponse> {
    return this.get(`/filesystem/directory?path=${encodeURIComponent(path)}`);
  }

  getRepoBranches(repoId: string): Promise<GitBranch[]> {
    return this.get(`/repos/${encodeURIComponent(repoId)}/branches`);
  }

  createAndStartWorkspace(body: CreateAndStartWorkspaceRequest): Promise<CreateAndStartWorkspaceResponse> {
    return this.post('/workspaces/start', body);
  }

  createOnlyWorkspace(body: CreateOnlyWorkspaceRequest): Promise<CreateOnlyWorkspaceResponse> {
    return this.post('/workspaces/create-only', body);
  }

  resolvePreview(request: PreviewResolveRequest): Promise<PreviewResolveResponse> {
    return this.post('/preview/resolve', request);
  }

  getRunConfigs(workspaceId: string): Promise<WorkspaceRunConfigsResponse> {
    return this.get(`/workspaces/${encodeURIComponent(workspaceId)}/execution/run-configs`);
  }

  upsertRunConfig(workspaceId: string, body: UpsertRunConfig): Promise<RunConfig> {
    return this.post(`/workspaces/${encodeURIComponent(workspaceId)}/execution/run-configs`, body);
  }

  upsertPreviewSlot(workspaceId: string, body: UpsertPreviewSlot): Promise<PreviewSlot> {
    return this.post(`/workspaces/${encodeURIComponent(workspaceId)}/execution/preview-slots`, body);
  }

  validatePreviewSlotTarget(
    workspaceId: string,
    body: { repo_id: string; target: PreviewSlotTarget },
  ): Promise<ValidatePreviewSlotTargetResponse> {
    return this.post(
      `/workspaces/${encodeURIComponent(workspaceId)}/execution/preview-slots/validate-target`,
      body,
    );
  }

  startRunConfig(workspaceId: string, runConfigId: string): Promise<RunConfigStartResponse> {
    return this.post(
      `/workspaces/${encodeURIComponent(workspaceId)}/execution/run-configs/${encodeURIComponent(runConfigId)}/start`,
      {},
    );
  }

  startPreviewSlot(workspaceId: string, previewSlotId: string): Promise<RunConfigStartResponse> {
    return this.post(
      `/workspaces/${encodeURIComponent(workspaceId)}/execution/preview-slots/${encodeURIComponent(previewSlotId)}/start`,
      {},
    );
  }

  getPreviewSlotUrl(
    workspaceId: string,
    previewSlotId: string,
    args: { customerSlug?: string; baseDomain?: string },
  ): Promise<PreviewSlotUrlResponse> {
    const params = new URLSearchParams();
    if (args.customerSlug) params.set('customerSlug', args.customerSlug);
    if (args.baseDomain) params.set('baseDomain', args.baseDomain);
    const query = params.toString();
    return this.get(
      `/workspaces/${encodeURIComponent(workspaceId)}/execution/preview-slots/${encodeURIComponent(previewSlotId)}/url${query ? `?${query}` : ''}`,
    );
  }

  async deleteRunConfig(workspaceId: string, runConfigId: string): Promise<void> {
    await this.delete(`/workspaces/${encodeURIComponent(workspaceId)}/execution/run-configs/${encodeURIComponent(runConfigId)}`);
  }

  async deletePreviewSlot(workspaceId: string, previewSlotId: string): Promise<void> {
    await this.delete(`/workspaces/${encodeURIComponent(workspaceId)}/execution/preview-slots/${encodeURIComponent(previewSlotId)}`);
  }

  async sendFollowUp(
    sessionId: string,
    prompt: string,
  ): Promise<ExecutionProcess> {
    const session = await this.getSession(sessionId);
    return this.post(`/sessions/${encodeURIComponent(sessionId)}/follow-up`, {
      prompt,
      executor_config: {
        executor: session.executor,
      },
      retry_process_id: null,
      force_when_dirty: null,
      perform_git_reset: null,
    });
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  private delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });

    const bodyText = await response.text();
    if (!response.ok) {
      const message = extractVkErrorMessage(bodyText)
        ?? `VK API ${path} failed: HTTP ${response.status} ${response.statusText}`;
      throw new VkApiError({
        message,
        status: response.status,
        bodyText,
      });
    }

    let envelope: ApiEnvelope<T>;
    try {
      envelope = JSON.parse(bodyText) as ApiEnvelope<T>;
    } catch (error) {
      throw new VkApiError({
        message: `VK API ${path} returned invalid JSON`,
        status: response.status,
        bodyText,
        errorData: error,
      });
    }

    if (!envelope.success) {
      throw new VkApiError({
        message: envelope.message || `VK API ${path} returned unsuccessful response`,
        status: response.status,
        bodyText,
        errorData: envelope.error_data,
      });
    }

    return envelope.data;
  }
}

export function selectLatestSession(sessions: Session[]): Session | null {
  if (sessions.length === 0) return null;
  return [...sessions].sort(
    (a, b) => parseTimestamp(b.created_at) - parseTimestamp(a.created_at),
  )[0] ?? null;
}

function parseTimestamp(value: string): number {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function extractVkErrorMessage(bodyText: string): string | null {
  try {
    const parsed = JSON.parse(bodyText) as { message?: unknown; error?: unknown };
    if (typeof parsed.message === 'string' && parsed.message.trim()) return parsed.message;
    if (typeof parsed.error === 'string' && parsed.error.trim()) return parsed.error;
  } catch {
    // Non-JSON VK errors still include the raw body on VkApiError.bodyText.
  }
  return null;
}

function defaultWebSocketFactory(): WebSocketFactory {
  const WebSocketConstructor = globalThis.WebSocket;
  if (!WebSocketConstructor) {
    throw new VkApiError({ message: 'VK execution log stream is unavailable in this runtime' });
  }
  return (url) => new WebSocketConstructor(url);
}
