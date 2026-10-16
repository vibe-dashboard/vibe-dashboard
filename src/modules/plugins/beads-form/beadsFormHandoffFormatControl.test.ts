// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BeadsFormHandoffFormatControl } from './beadsFormHandoffFormatControl';

afterEach(cleanup);

describe('BeadsForm handoff format control', () => {
  it('shows XML by default and lets the user select JSON', () => {
    const onChange = vi.fn();
    const view = render(React.createElement(BeadsFormHandoffFormatControl, { format: 'xml', onChange }));
    const select = view.getByLabelText('Copy format');

    expect((select as HTMLSelectElement).value).toBe('xml');
    fireEvent.change(select, { target: { value: 'json' } });
    expect(onChange).toHaveBeenCalledWith('json');
  });
});
