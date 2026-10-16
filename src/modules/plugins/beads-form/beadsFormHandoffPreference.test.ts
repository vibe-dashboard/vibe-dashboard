import { describe, expect, it, vi } from 'vitest';

import {
  BEADS_FORM_HANDOFF_FORMAT_STORAGE_KEY,
  readBeadsFormHandoffFormat,
  writeBeadsFormHandoffFormat,
} from './beadsFormHandoffPreference';

describe('BeadsForm handoff preference', () => {
  it('defaults to XML for absent, unknown, corrupt, or unavailable storage', () => {
    expect(readBeadsFormHandoffFormat()).toBe('xml');
    expect(readBeadsFormHandoffFormat({ getItem: () => null })).toBe('xml');
    expect(readBeadsFormHandoffFormat({ getItem: () => 'yaml' })).toBe('xml');
    expect(readBeadsFormHandoffFormat({ getItem: () => { throw new Error('blocked'); } })).toBe('xml');
  });

  it('reads JSON and writes the versioned plugin-local key without throwing', () => {
    expect(readBeadsFormHandoffFormat({ getItem: () => 'json' })).toBe('json');
    const setItem = vi.fn();
    writeBeadsFormHandoffFormat({ setItem }, 'json');
    expect(setItem).toHaveBeenCalledWith(BEADS_FORM_HANDOFF_FORMAT_STORAGE_KEY, 'json');
    expect(() => writeBeadsFormHandoffFormat({ setItem: () => { throw new Error('quota'); } }, 'xml')).not.toThrow();
  });
});
