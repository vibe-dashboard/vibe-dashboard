import React from 'react';

import { resolveBeadsFormType, type BeadsFormDefinition } from './beadsFormCore';

export function BeadsFormTypeBadge({ form }: { form: Pick<BeadsFormDefinition, 'type'> }) {
  const type = resolveBeadsFormType(form);
  return <span className={`beads-form-type beads-form-type--${type}`}>{type === 'code-review' ? 'Code review' : 'Questionnaire'}</span>;
}

export function AggregateBeadsFormTypeCue({
  form,
  compiledFormMounted,
}: {
  form?: Pick<BeadsFormDefinition, 'type'>;
  compiledFormMounted: boolean;
}) {
  return !compiledFormMounted && form ? <BeadsFormTypeBadge form={form} /> : null;
}
