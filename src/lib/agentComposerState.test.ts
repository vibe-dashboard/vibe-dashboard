import { describe, expect, it } from 'vitest';
import {
  PERMISSION_POLICY_VALUES,
  agentDraftStorageKey,
  createExecutorConfig,
  draftFromQueuedMessage,
  mergeRetainedIframeTabs,
  parseAgentDraft,
  normalizeExecutorConfig,
  resolveExecutor,
  serializeAgentDraft,
} from './agentComposerState';

describe('Agent composer state', () => {
  it('normalizes unknown executor values at the UI boundary', () => {
    expect(normalizeExecutorConfig({ executor: 'FUTURE' } as never)).toEqual({
      executor: 'CODEX',
      permission_policy: null,
    });
  });
  it('narrows known executors and safely falls back for unknown wire values', () => {
    expect(resolveExecutor({ executor: 'GEMINI' } as never)).toBe('GEMINI');
    expect(resolveExecutor({ executor: null } as never)).toBe('CODEX');
    expect(resolveExecutor({ executor: 'FUTURE' } as never)).toBe('CODEX');
  });

  it('normalizes all compact executor controls', () => {
    expect(
      createExecutorConfig({
        executor: 'CODEX',
        variant: ' ',
        modelId: ' gpt-5 ',
        reasoningId: ' high ',
        permissionPolicy: ' ',
      }),
    ).toEqual({
      executor: 'CODEX',
      variant: null,
      model_id: 'gpt-5',
      reasoning_id: 'high',
      permission_policy: null,
    });
  });

  it('limits permission policy to VK-supported enum values', () => {
    expect(PERMISSION_POLICY_VALUES).toEqual(['', 'AUTO', 'SUPERVISED', 'PLAN']);
    expect(
      createExecutorConfig({
        executor: 'CODEX',
        variant: '',
        modelId: '',
        reasoningId: '',
        permissionPolicy: 'free text',
      }).permission_policy,
    ).toBeNull();
    expect(
      createExecutorConfig({
        executor: 'CODEX',
        variant: '',
        modelId: '',
        reasoningId: '',
        permissionPolicy: 'SUPERVISED',
      }).permission_policy,
    ).toBe('SUPERVISED');
  });

  it('isolates and round-trips local draft mirrors', () => {
    expect(agentDraftStorageKey('w', 'a')).not.toBe(
      agentDraftStorageKey('w', 'b'),
    );
    const config = createExecutorConfig({
      executor: 'CODEX',
      variant: '',
      modelId: '',
      reasoningId: '',
      permissionPolicy: '',
    });
    expect(parseAgentDraft(serializeAgentDraft('hello', config))).toEqual({
      message: 'hello',
      executorConfig: config,
    });
    expect(parseAgentDraft('legacy')).toEqual({ message: 'legacy' });
  });

  it('keeps queued cancellation recovery as the complete queued draft', () => {
    expect(
      draftFromQueuedMessage({
        status: 'queued',
        message: {
          session_id: 's1',
          queued_at: '2026-09-24T00:00:00Z',
          data: {
            message: 'queued text',
            executor_config: {
              executor: 'GEMINI',
              variant: 'queued-variant',
              model_id: 'queued-model',
              reasoning_id: 'high',
              permission_policy: 'PLAN',
            },
            session_command: null,
          },
        },
      }),
    ).toEqual({
      message: 'queued text',
      executor_config: {
        executor: 'GEMINI',
        variant: 'queued-variant',
        model_id: 'queued-model',
        reasoning_id: 'high',
        permission_policy: 'PLAN',
      },
      session_command: null,
    });
  });

  it('overlays visible effective iframe tabs onto retained persisted entries', () => {
    const retained = [
      { iframeKey: 'workspace:agent', tab: { url: '/old' } },
      { iframeKey: 'workspace:hidden', tab: { url: '/hidden' } },
    ];
    const visible = [
      { iframeKey: 'workspace:agent', tab: { url: '/new?session_id=s2' } },
    ];

    expect(mergeRetainedIframeTabs(retained, visible, new Set(['workspace:agent']))).toEqual([
      { iframeKey: 'workspace:agent', tab: { url: '/new?session_id=s2' } },
      { iframeKey: 'workspace:hidden', tab: { url: '/hidden' } },
    ]);
  });
});
