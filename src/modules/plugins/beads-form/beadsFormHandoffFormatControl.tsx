import React from 'react';

import type { BeadsFormHandoffFormat } from './beadsFormHandoffPreference';

export function BeadsFormHandoffFormatControl({ format, onChange }: {
  format: BeadsFormHandoffFormat;
  onChange: (format: BeadsFormHandoffFormat) => void;
}) {
  return (
    <label className="beadsform-handoff-format">
      Copy format
      <select value={format} onChange={(event) => onChange(event.target.value as BeadsFormHandoffFormat)}>
        <option value="xml">XML</option>
        <option value="json">JSON</option>
      </select>
    </label>
  );
}
