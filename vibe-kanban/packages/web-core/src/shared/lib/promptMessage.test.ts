import { describe, expect, it } from 'vitest';
import { buildAgentPrompt, getUserVisiblePrompt } from './promptMessage';

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

describe('user-visible attachment messages', () => {
  it.each(['.alohak-attachments', '.vibe-attachments'])(
    'shows the original message and attachment links for %s',
    (directory) => {
      const message = `Please inspect this image.\n\n![screen.png](${directory}/screen.png)`;
      const { prompt } = buildAgentPrompt(message, []);

      expect(getUserVisiblePrompt(prompt)).toBe(message);
    }
  );

  it('shows both old and new attachment links with review context', () => {
    const message =
      '[old](.vibe-attachments/old.txt)\n[new](.alohak-attachments/new.txt)';
    const { prompt } = buildAgentPrompt(message, ['Review context']);

    expect(getUserVisiblePrompt(prompt)).toBe(`Review context\n\n${message}`);
  });

  it('renders persisted legacy prompts as the original user message', () => {
    const message = '![photo](.vibe-attachments/photo.png)';
    const legacyPrompt = `${message}\n\nUser attachments are stored in \`.vibe-attachments/\` relative to your session's working directory. Open the linked attachment paths above to inspect their contents. For image attachments, use your image-viewing tool to inspect the image itself.`;

    expect(getUserVisiblePrompt(legacyPrompt)).toBe(message);
  });

  it('preserves ordinary text and formatting verbatim', () => {
    const message =
      '  Please explain attachments.\n\nUser attachments are stored in a folder I chose.\n\n```txt\nkeep this\n```\n';

    expect(getUserVisiblePrompt(message)).toBe(message);
  });
});
