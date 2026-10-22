import { describe, expect, it, vi } from 'vitest';

import {
  BEADS_FORM_HANDOFF_FORMAT_STORAGE_KEY,
  readBeadsFormHandoffFormat,
  writeBeadsFormHandoffFormat,
} from './beadsFormHandoffPreference';

describe('BeadsForm handoff format preference', () => {
  it('defaults to XML when storage is absent, empty, corrupt, or throws', () => {
    expect(readBeadsFormHandoffFormat()).toBe('xml');
    expect(readBeadsFormHandoffFormat({ getItem: () => null })).toBe('xml');
    expect(readBeadsFormHandoffFormat({ getItem: () => 'yaml' })).toBe('xml');
    expect(readBeadsFormHandoffFormat({ getItem: () => { throw new Error('blocked'); } })).toBe('xml');
  });

  it('reads JSON and writes the versioned plugin-local preference', () => {
    expect(readBeadsFormHandoffFormat({ getItem: () => 'json' })).toBe('json');
    const setItem = vi.fn();
    writeBeadsFormHandoffFormat({ setItem }, 'json');
    expect(setItem).toHaveBeenCalledWith(BEADS_FORM_HANDOFF_FORMAT_STORAGE_KEY, 'json');
  });

  it('does not let unavailable storage break the form', () => {
    expect(() => writeBeadsFormHandoffFormat({ setItem: () => { throw new Error('quota'); } }, 'xml')).not.toThrow();
  });
});
