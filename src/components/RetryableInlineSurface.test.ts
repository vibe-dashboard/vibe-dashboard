// @vitest-environment jsdom
import React, { useState } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RetryableInlineSurface } from './RetryableInlineSurface';

afterEach(cleanup);

describe('inline surface recovery', () => {
  it.each(['Agent chat', 'Create Workspace'])(
    'identifies loading %s',
    async (label) => {
      const load = () =>
        new Promise<{ default: React.ComponentType<object> }>(() => {});
      render(
        React.createElement(RetryableInlineSurface, {
          label,
          load,
          componentProps: {},
        }),
      );
      expect(screen.getByRole('status').textContent).toBe(`Loading ${label}…`);
    },
  );

  it('retries a rejected module load without resetting an adjacent draft', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary import failure'))
      .mockResolvedValue({
        default: () => React.createElement('p', null, 'Agent connected'),
      });
    function Draft() {
      const [draft, setDraft] = useState('');
      return React.createElement('input', {
        'aria-label': 'Other draft',
        value: draft,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          setDraft(event.target.value),
      });
    }
    try {
      render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(Draft),
          React.createElement(RetryableInlineSurface, {
            label: 'Agent chat',
            load,
            componentProps: {},
          }),
        ),
      );
      fireEvent.change(screen.getByLabelText('Other draft'), {
        target: { value: 'Keep this draft' },
      });
      fireEvent.click(
        await screen.findByRole('button', { name: 'Retry Agent chat' }),
      );
      expect(await screen.findByText('Agent connected')).toBeTruthy();
      expect(
        (screen.getByLabelText('Other draft') as HTMLInputElement).value,
      ).toBe('Keep this draft');
    } finally {
      error.mockRestore();
    }
  });

  it('recovers from a render error on retry', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let broken = true;
    const load = async () => ({
      default: () => {
        if (broken) throw new Error('provider bootstrap failed');
        return React.createElement('p', null, 'Create ready');
      },
    });
    try {
      render(
        React.createElement(RetryableInlineSurface, {
          label: 'Create Workspace',
          load,
          componentProps: {},
        }),
      );
      await screen.findByRole('alert');
      broken = false;
      await act(async () =>
        fireEvent.click(
          screen.getByRole('button', { name: 'Retry Create Workspace' }),
        ),
      );
      expect(await screen.findByText('Create ready')).toBeTruthy();
    } finally {
      error.mockRestore();
    }
  });
});
