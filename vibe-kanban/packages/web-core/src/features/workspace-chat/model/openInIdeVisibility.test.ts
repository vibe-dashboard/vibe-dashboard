import { describe, expect, it } from 'vitest';
import { shouldShowOpenInIde } from './openInIdeVisibility';

describe('shouldShowOpenInIde', () => {
  it('never exposes desktop IDE launch on mobile', () => {
    expect(
      shouldShowOpenInIde({
        isMobile: true,
        hostname: 'localhost',
        remoteSshHost: 'dev.example.test',
      })
    ).toBe(false);
  });

  it('allows a browser-local VK server without Remote SSH', () => {
    expect(
      shouldShowOpenInIde({
        isMobile: false,
        hostname: '127.0.0.1',
        remoteSshHost: null,
      })
    ).toBe(true);
  });

  it('requires Remote SSH when VK is reached through a remote host', () => {
    expect(
      shouldShowOpenInIde({
        isMobile: false,
        hostname: 'vk.example.test',
        remoteSshHost: null,
      })
    ).toBe(false);
    expect(
      shouldShowOpenInIde({
        isMobile: false,
        hostname: 'vk.example.test',
        remoteSshHost: 'dev.example.test',
      })
    ).toBe(true);
  });
});
