import { describe, expect, it } from 'vitest';
import { codexUsageAlertContent, codexUsageEventId, codexUsageLimitEvents } from './codex-usage.js';

describe('structured Codex usage evidence', () => {
  const event = { code: 'usage_limit_exceeded' as const, thread_id: 'thread', turn_id: 'turn' };
  it('deduplicates a canonical turn while retaining distinct turns and process identities', () => {
    expect(codexUsageLimitEvents([event, event, { ...event, turn_id: 'other' }])).toHaveLength(2);
    expect(codexUsageEventId('w', 's', 'p', event)).toBe(codexUsageEventId('w', 's', 'p', { ...event }));
    expect(codexUsageEventId('w', 's', 'p', event)).not.toBe(codexUsageEventId('w', 's', 'p2', event));
    expect(codexUsageEventId('w', 's', 'p', event)).not.toBe(codexUsageEventId('w', 's', 'p', { ...event, turn_id: 'other' }));
  });
  it.each([null, 'usageLimitExceeded', [{ usedPercent: 100 }], [{ ...event, code: 'unauthorized' }], [{ ...event, turn_id: '' }]])('rejects unsupported or malformed evidence %j', value => {
    expect(() => codexUsageLimitEvents(value)).toThrow('Invalid structured');
  });
  it('treats an absent old-backend field as no evidence and builds an encoded VK_ORIGIN workspace link', () => {
    expect(codexUsageLimitEvents(undefined)).toEqual([]);
    expect(codexUsageAlertContent('https://vk.example/', 'ws/a', 's', 'p')).toContain('https://vk.example/workspaces/ws%2Fa');
    expect(() => codexUsageAlertContent(undefined, 'w', 's', 'p')).toThrow('VK_ORIGIN');
    expect(() => codexUsageAlertContent('file:///tmp', 'w', 's', 'p')).toThrow('HTTP(S)');
  });
});
