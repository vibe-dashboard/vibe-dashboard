const PRESET_SELECTOR = '.beads-form-next-instruction-preset';

export function initializeNextInstructionPresets(host: ParentNode): () => void {
  const listeners: Array<{ button: HTMLButtonElement; click: () => void }> = [];
  for (const button of host.querySelectorAll<HTMLButtonElement>(PRESET_SELECTOR)) {
    const prompt = button.closest('.beads-form-next-instruction');
    const textarea = prompt?.querySelector<HTMLTextAreaElement>('textarea[name="next_instruction"]');
    if (!textarea) continue;
    const click = () => {
      textarea.value = button.value;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      textarea.focus();
    };
    button.addEventListener('click', click);
    listeners.push({ button, click });
  }
  return () => {
    for (const { button, click } of listeners) button.removeEventListener('click', click);
  };
}
