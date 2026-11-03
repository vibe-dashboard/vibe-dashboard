/** HeroUI palette overrides injected into Pierre's shadow root via unsafeCSS. */
export const PIERRE_DIFFS_THEME_CSS = `
  [data-separator="line-info"][data-separator-first] {
    padding-top: 4px;
  }
  [data-separator="line-info"][data-separator-last] {
    padding-bottom: 4px;
  }

  [data-disable-line-numbers][data-indicators='classic'] [data-column-content] {
    padding-inline-start: calc(2ch + 1ch);
  }
  [data-disable-line-numbers][data-indicators='classic'] [data-line-type='change-addition'] [data-column-content]::before,
  [data-disable-line-numbers][data-indicators='classic'] [data-line-type='change-deletion'] [data-column-content]::before {
    left: 1ch;
  }

  /* Show scrollbar only on hover */
  [data-code] {
    padding-bottom: 0 !important;
  }
  [data-code]::-webkit-scrollbar {
    height: 8px !important;
    background: transparent !important;
  }
  [data-code]::-webkit-scrollbar-track {
    background: transparent !important;
  }
  [data-code]::-webkit-scrollbar-thumb {
    background-color: transparent !important;
    border-radius: 4px !important;
  }
  [data-code]:hover::-webkit-scrollbar-thumb {
    background-color: hsl(var(--heroui-default-500) / 0.3) !important;
  }

  /* Keep GitHub syntax highlighting while chrome and diff surfaces follow HeroUI. */
  [data-diff] {
    --diffs-gap-style: none !important;
    --diffs-light-bg: hsl(var(--heroui-content1)) !important;
    --diffs-dark-bg: hsl(var(--heroui-content1)) !important;
    --diffs-bg: hsl(var(--heroui-content1)) !important;
    --diffs-bg-context-override: hsl(var(--heroui-content1)) !important;
    --diffs-bg-separator-override: hsl(var(--heroui-content1)) !important;
    --diffs-bg-hover-override: hsl(var(--heroui-content2)) !important;
    --diffs-fg-number-override: hsl(var(--heroui-default-500)) !important;
    --diffs-light-addition-color: hsl(var(--heroui-success)) !important;
    --diffs-dark-addition-color: hsl(var(--heroui-success)) !important;
    --diffs-bg-addition-override: color-mix(in srgb, hsl(var(--heroui-success)) 12%, hsl(var(--heroui-content1))) !important;
    --diffs-bg-addition-number-override: color-mix(in srgb, hsl(var(--heroui-success)) 18%, hsl(var(--heroui-content1))) !important;
    --diffs-bg-addition-hover-override: color-mix(in srgb, hsl(var(--heroui-success)) 24%, hsl(var(--heroui-content1))) !important;
    --diffs-light-deletion-color: hsl(var(--heroui-danger)) !important;
    --diffs-dark-deletion-color: hsl(var(--heroui-danger)) !important;
    --diffs-bg-deletion-override: color-mix(in srgb, hsl(var(--heroui-danger)) 12%, hsl(var(--heroui-content1))) !important;
    --diffs-bg-deletion-number-override: color-mix(in srgb, hsl(var(--heroui-danger)) 18%, hsl(var(--heroui-content1))) !important;
    --diffs-bg-deletion-hover-override: color-mix(in srgb, hsl(var(--heroui-danger)) 24%, hsl(var(--heroui-content1))) !important;
    --diffs-font-family: "IBM Plex Mono", ui-monospace, monospace;
  }
`;
