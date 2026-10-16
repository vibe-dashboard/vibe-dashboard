export type BeadsFormHandoffFormat = 'xml' | 'json';

export const BEADS_FORM_HANDOFF_FORMAT_STORAGE_KEY = 'vibe-dashboard:beads-form:handoff-format:v1';

export function readBeadsFormHandoffFormat(storage?: Pick<Storage, 'getItem'>): BeadsFormHandoffFormat {
  if (!storage) return 'xml';
  try {
    return storage.getItem(BEADS_FORM_HANDOFF_FORMAT_STORAGE_KEY) === 'json' ? 'json' : 'xml';
  } catch {
    return 'xml';
  }
}

export function writeBeadsFormHandoffFormat(
  storage: Pick<Storage, 'setItem'> | undefined,
  format: BeadsFormHandoffFormat,
): void {
  if (!storage) return;
  try {
    storage.setItem(BEADS_FORM_HANDOFF_FORMAT_STORAGE_KEY, format);
  } catch {
    // A blocked or quota-limited preference must not block form submission.
  }
}
