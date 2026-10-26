import { describe, expect, it } from 'vitest';
import { buildAgentPrompt } from './promptMessage';

describe('attachment prompt delivery', () => {
  it.each(['.alohak-attachments', '.vibe-attachments'])(
    'directs the agent to image and file attachments in %s',
    (directory) => {
      const message = `![screen\\[1\\].png](${directory}/screen.png)\n[notes.txt](${directory}/notes.txt)`;
      const { prompt } = buildAgentPrompt(message, ['Review context']);

      expect(prompt).toContain(`Review context\n\n${message}`);
      expect(prompt).toContain(`stored in \`${directory}/\``);
      expect(prompt).toContain("relative to your session's working directory");
      expect(prompt).toContain('Open the linked attachment paths');
      expect(prompt).toContain('use your image-viewing tool');
    }
  );

  it('guides the agent to both directories when a message includes old and new files', () => {
    const { prompt } = buildAgentPrompt(
      '[old](.vibe-attachments/old.txt)\n[new](.alohak-attachments/new.txt)',
      []
    );

    expect(prompt).toContain(
      'stored in `.vibe-attachments/` and `.alohak-attachments/`'
    );
  });

  it('preserves ordinary messages and slash-command dispatch', () => {
    expect(buildAgentPrompt('Explain this', ['Review context'])).toEqual({
      prompt: 'Review context\n\nExplain this',
      isSlashCommand: false,
    });
    const command = '/review [notes](.alohak-attachments/notes.txt)';
    expect(buildAgentPrompt(` ${command} `, ['Review context'])).toEqual({
      prompt: command,
      isSlashCommand: true,
    });
  });
});
