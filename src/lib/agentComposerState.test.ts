import { describe, expect, it } from 'vitest';
import {
  agentDraftStorageKey,
  createExecutorConfig,
  parseAgentDraft,
  normalizeExecutorConfig,
  resolveExecutor,
  serializeAgentDraft,
} from './agentComposerState';

describe('Agent composer state', () => {
  it('normalizes unknown executor values at the UI boundary', () => {
    expect(normalizeExecutorConfig({ executor: 'FUTURE' } as never)).toEqual({
      executor: 'CODEX',
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
});
