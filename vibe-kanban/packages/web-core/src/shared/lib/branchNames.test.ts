import { describe, expect, it } from 'vitest';
import { branchNamesConflictAsSelfTarget } from './branchNames';

describe('branchNamesConflictAsSelfTarget', () => {
  it('rejects exact same branch names', () => {
    expect(branchNamesConflictAsSelfTarget('feature', 'feature', false)).toBe(
      true
    );
  });

  it('rejects remote-tracking form of the same source branch', () => {
    expect(branchNamesConflictAsSelfTarget('main', 'origin/main', true)).toBe(
      true
    );
  });

  it('does not reject valid local slash branch names', () => {
    expect(
      branchNamesConflictAsSelfTarget('bar/baz', 'foo/bar/baz', false)
    ).toBe(false);
  });
});
