// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeNextInstructionPresets } from './beadsFormNextInstructionPresets';
import { setFormFieldsReadOnly } from './beadsFormPreviewState';

describe('Next Instruction presets', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <form>
        <div class="beads-form-next-instruction">
          <div class="beads-form-next-instruction-presets" role="group" aria-label="Next Instruction presets">
            <button type="button" class="beads-form-next-instruction-preset" value="Create another form to discuss additional unknowns in detail">Discuss unknowns</button>
            <button type="button" class="beads-form-next-instruction-preset" value="Summarize and stop.">Stop</button>
          </div>
          <textarea name="next_instruction">Keep this editable.</textarea>
        </div>
      </form>`;
  });

  it('replaces the one canonical textarea value and emits draft-compatible events', () => {
    const form = document.querySelector('form')!;
    const input = vi.fn();
    const change = vi.fn();
    form.addEventListener('input', input);
    form.addEventListener('change', change);
    const cleanup = initializeNextInstructionPresets(form);

    document.querySelector<HTMLButtonElement>('.beads-form-next-instruction-preset')!.click();

    const textarea = document.querySelector<HTMLTextAreaElement>('[name="next_instruction"]')!;
    expect(textarea.value).toBe('Create another form to discuss additional unknowns in detail');
    expect(input).toHaveBeenCalledOnce();
    expect(change).toHaveBeenCalledOnce();
    textarea.value += '\nThen wait.';
    expect(textarea.value).toContain('Then wait.');
    expect(new FormData(form).get('next_instruction')).toBe(textarea.value);
    expect(Array.from(new FormData(form).keys())).toEqual(['next_instruction']);

    cleanup();
    document.querySelectorAll<HTMLButtonElement>('.beads-form-next-instruction-preset')[1]!.click();
    expect(textarea.value).toContain('Then wait.');
  });

  it('locks and restores preset controls with submitted edit state', () => {
    const form = document.querySelector('form')!;
    const buttons = Array.from(form.querySelectorAll<HTMLButtonElement>('.beads-form-next-instruction-preset'));

    setFormFieldsReadOnly(form, true);
    expect(buttons.every((button) => button.disabled)).toBe(true);
    setFormFieldsReadOnly(form, false);
    expect(buttons.every((button) => !button.disabled)).toBe(true);
  });
});
