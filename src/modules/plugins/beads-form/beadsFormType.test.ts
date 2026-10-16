// @vitest-environment jsdom

import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { compileBeadsForm } from '../../../../packages/beads-form/src/index';
import { AggregateBeadsFormTypeCue } from './beadsFormType';

afterEach(cleanup);

describe('aggregate BeadsForm type cue', () => {
  const form = {
    format: 'standard' as const,
    type: 'code-review' as const,
    id: 'review',
    goal: 'Review the change.',
    title: 'Code review',
    questions: [],
  };

  it('renders exactly one cue while the compiled form is mounted', () => {
    const compiled = compileBeadsForm(form);
    const view = render(React.createElement(React.Fragment, null,
      React.createElement(AggregateBeadsFormTypeCue, { form, compiledFormMounted: true }),
      React.createElement('div', { dangerouslySetInnerHTML: { __html: compiled.html } }),
    ));

    expect(view.container.querySelectorAll('.beads-form-type')).toHaveLength(1);
    expect(view.container.querySelector('.beads-form-type')?.textContent).toBe('Code review');
  });

  it('renders the outer cue when success replaces the compiled form', () => {
    const view = render(React.createElement(AggregateBeadsFormTypeCue, { form, compiledFormMounted: false }));

    expect(view.container.querySelectorAll('.beads-form-type')).toHaveLength(1);
    expect(view.getByText('Code review')).toBeTruthy();
  });
});
