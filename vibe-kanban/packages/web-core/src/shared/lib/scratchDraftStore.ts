import { ScratchType } from 'shared/types';

export interface StoredScratchDraft<T> {
  value: T;
  dirty: boolean;
  updatedAt: number;
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getScratchDraftStorageKey(
  scratchType: ScratchType,
  id: string
): string {
  return `vk:scratch-draft:${scratchType}:${id}`;
}

export function areScratchDraftValuesEqual<T>(
  left: T | null | undefined,
  right: T | null | undefined
): boolean {
  if (left === right) return true;
  if (left == null || right == null) return left == null && right == null;

  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

export function readStoredScratchDraft<T>(
  scratchType: ScratchType,
  id: string
): StoredScratchDraft<T> | null {
  if (!id) return null;

  const storage = getStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(getScratchDraftStorageKey(scratchType, id));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as StoredScratchDraft<T>;
    if (typeof parsed !== 'object' || parsed == null || !('value' in parsed)) {
      return null;
    }

    return {
      value: parsed.value,
      dirty: parsed.dirty === true,
      updatedAt:
        typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function writeStoredScratchDraft<T>(
  scratchType: ScratchType,
  id: string,
  value: T,
  dirty: boolean
): void {
  if (!id) return;

  const storage = getStorage();
  if (!storage) return;

  try {
    const record: StoredScratchDraft<T> = {
      value,
      dirty,
      updatedAt: Date.now(),
    };
    storage.setItem(
      getScratchDraftStorageKey(scratchType, id),
      JSON.stringify(record)
    );
  } catch {
    // Ignore storage failures and continue without local durability.
  }
}

export function acknowledgeStoredScratchDraft<T>(
  scratchType: ScratchType,
  id: string,
  authoritativeValue: T | null | undefined
): boolean {
  const cachedDraft = readStoredScratchDraft<T>(scratchType, id);
  if (!cachedDraft?.dirty) return false;
  if (!areScratchDraftValuesEqual(cachedDraft.value, authoritativeValue)) {
    return false;
  }

  writeStoredScratchDraft(scratchType, id, cachedDraft.value, false);
  return true;
}

export function clearStoredScratchDraft(
  scratchType: ScratchType,
  id: string
): void {
  if (!id) return;

  const storage = getStorage();
  if (!storage) return;

  try {
    storage.removeItem(getScratchDraftStorageKey(scratchType, id));
  } catch {
    // Ignore storage failures and continue.
  }
}
