// ── VK Backend API types ────────────────────────────────────────────────────

export interface Workspace {
  id: string;
  task_id: string;
  container_ref: string | null;
  branch: string;
  agent_working_dir: string | null;
  created_at: string;
  updated_at: string;
  archived: boolean;
  pinned: boolean;
  name: string | null;
}

export interface WorkspaceSummary {
  workspace_id: string;
  has_pending_approval: boolean;
  files_changed: number | null;
  lines_added: number | null;
  lines_removed: number | null;
  latest_process_completed_at?: string;
  latest_process_status:
    | 'running'
    | 'completed'
    | 'failed'
    | 'killed'
    | null;
  has_running_dev_server: boolean;
  has_unseen_turns: boolean;
  pr_status: 'open' | 'merged' | 'closed' | 'unknown' | null;
}

export interface WorkspaceSummaryResponse {
  summaries: WorkspaceSummary[];
}

export interface Repo {
  id: string;
  name: string;
  display_name: string;
}

export interface RepoWithBranch {
  id: string;
  name: string;
  display_name: string;
  target_branch: string;
}

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

export interface Session {
  id: string;
  workspace_id: string;
  executor: Executor | string | null;
  name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExecutorConfig {
  executor: Executor;
  variant?: string | null;
  model_id?: string | null;
  reasoning_id?: string | null;
  permission_policy?: string | null;
}

export interface DraftFollowUpData {
  message: string;
  executor_config: ExecutorConfig;
  session_command: null;
}

export type QueueStatus =
  | { status: 'empty' }
  | {
      status: 'queued';
      message: {
        session_id: string;
        data: DraftFollowUpData;
        queued_at: string;
      };
    };

interface Scratch {
  payload?: { type: 'DRAFT_FOLLOW_UP'; data: DraftFollowUpData };
}

// ── API response envelope ───────────────────────────────────────────────────

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

// ── Client ──────────────────────────────────────────────────────────────────

export class VibeKanbanClient {
  constructor(private baseUrl = '/vk-api') {}

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`);
    if (!res.ok) {
      throw new Error(`GET ${path} failed: ${res.statusText}`);
    }
    const json: ApiResponse<T> = await res.json();
    if (!json.success) {
      throw new Error(`GET ${path} returned unsuccessful response`);
    }
    return json.data;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`POST ${path} failed: ${res.statusText}`);
    }
    const json: ApiResponse<T> = await res.json();
    if (!json.success) {
      throw new Error(`POST ${path} returned unsuccessful response`);
    }
    return json.data;
  }

  private async mutate<T>(
    method: 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${method} ${path} failed: ${res.statusText}`);
    const json: ApiResponse<T> = await res.json();
    if (!json.success)
      throw new Error(`${method} ${path} returned unsuccessful response`);
    return json.data;
  }

  getWorkspaces(): Promise<Workspace[]> {
    return this.get('/workspaces');
  }

  getWorkspace(id: string): Promise<Workspace> {
    return this.get(`/workspaces/${id}`);
  }

  getWorkspaceSummaries(
    archived: boolean
  ): Promise<WorkspaceSummaryResponse> {
    return this.post('/workspaces/summaries', { archived });
  }

  getWorkspaceRepos(id: string): Promise<RepoWithBranch[]> {
    return this.get(`/workspaces/${id}/repos`);
  }

  getSessions(workspaceId: string): Promise<Session[]> {
    return this.get(
      `/sessions?workspace_id=${encodeURIComponent(workspaceId)}`,
    );
  }

  sendFollowUp(sessionId: string, data: DraftFollowUpData): Promise<unknown> {
    return this.post(`/sessions/${encodeURIComponent(sessionId)}/follow-up`, {
      prompt: data.message,
      executor_config: data.executor_config,
      retry_process_id: null,
      force_when_dirty: null,
      perform_git_reset: null,
    });
  }

  getQueueStatus(sessionId: string): Promise<QueueStatus> {
    return this.get(`/sessions/${encodeURIComponent(sessionId)}/queue`);
  }

  queueFollowUp(sessionId: string, data: DraftFollowUpData): Promise<QueueStatus> {
    return this.post(`/sessions/${encodeURIComponent(sessionId)}/queue`, data);
  }

  cancelQueuedFollowUp(sessionId: string): Promise<QueueStatus> {
    return this.mutate('DELETE', `/sessions/${encodeURIComponent(sessionId)}/queue`);
  }

  stopSessionExecution(sessionId: string): Promise<void> {
    return this.post(`/sessions/${encodeURIComponent(sessionId)}/execution/stop`, {});
  }

  async getFollowUpDraft(sessionId: string): Promise<DraftFollowUpData | null> {
    try {
      const value = await this.get<Scratch>(
        `/scratch/DRAFT_FOLLOW_UP/${encodeURIComponent(sessionId)}`,
      );
      return value.payload?.type === 'DRAFT_FOLLOW_UP'
        ? value.payload.data
        : null;
    } catch {
      return null;
    }
  }

  saveFollowUpDraft(sessionId: string, data: DraftFollowUpData): Promise<void> {
    return this.mutate(
      'PUT',
      `/scratch/DRAFT_FOLLOW_UP/${encodeURIComponent(sessionId)}`,
      { payload: { type: 'DRAFT_FOLLOW_UP', data } },
    );
  }

  deleteFollowUpDraft(sessionId: string): Promise<void> {
    return this.mutate(
      'DELETE',
      `/scratch/DRAFT_FOLLOW_UP/${encodeURIComponent(sessionId)}`,
    );
  }

  getWorkspaceBranchStatus(id: string): Promise<unknown> {
    return this.get(`/workspaces/${id}/git/status`);
  }

  getRepos(): Promise<Repo[]> {
    return this.get('/repos');
  }

  stopWorkspaceExecution(workspaceId: string): Promise<void> {
    return this.post(`/workspaces/${workspaceId}/execution/stop`, {});
  }
}

export const vkClient = new VibeKanbanClient();
