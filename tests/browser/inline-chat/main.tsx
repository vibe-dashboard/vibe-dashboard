import React, { useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { InlineVkAgentChat, InlineVkCreateWorkspace } from '@vibe/inline-chat';
import { WorkspacePreviewMenu } from '../../../src/components/WorkspacePreviewMenu';
import { PreviewRunConfigsPanel } from '../../../src/components/PreviewRunConfigsPanel';
import '../../../src/styles.css';
import { applyTheme } from '../../../src/lib/themeDocument';
import {
  getTheme,
  themes,
  type ThemeId,
  type UIFont,
} from '../../../src/lib/themes';
import { HeroUIProvider } from '@heroui/react';
import { ThemeSelectorControls } from '../../../src/components/ThemeSelector';

function Harness() {
  const [leftVisible, setLeftVisible] = useState(true);
  const [configured, setConfigured] = useState('');
  const [diffRequested, setDiffRequested] = useState('');
  const [themeId, setThemeId] = useState<ThemeId>('neutral-dark');
  const [uiFont, setUIFont] = useState<UIFont>('ibm-plex-mono');
  useLayoutEffect(() => {
    applyTheme(document.documentElement, { themeId, uiFont });
  }, [themeId, uiFont]);
  const mode = getTheme(themeId).mode;
  const rightWorkspace =
    new URLSearchParams(location.search).get('right') ?? 'workspace-1';
  if (new URLSearchParams(location.search).has('preview-config')) {
    return <PreviewRunConfigsPanel workspaceId="workspace-1" />;
  }
  if (new URLSearchParams(location.search).has('create')) {
    return (
      <div style={{ height: '100vh' }}>
        <InlineVkCreateWorkspace surfaceId="create" theme={{ mode }} />
      </div>
    );
  }
  return (
    <>
      {new URLSearchParams(location.search).has('appearance-controls') && (
        <div className="w-72">
          <ThemeSelectorControls
            preferences={{ themeId, uiFont }}
            setTheme={(id) => {
              if (new URLSearchParams(location.search).has('fail-save'))
                return Promise.reject(new Error('Save failed'));
              setThemeId(id as ThemeId);
            }}
            setUIFont={(font) => setUIFont(font as UIFont)}
          />
        </div>
      )}
      <label>
        Theme preview
        <select
          aria-label="Theme preview"
          value={themeId}
          onChange={(event) => setThemeId(event.target.value as ThemeId)}
        >
          {themes.map((theme) => (
            <option key={theme.id} value={theme.id}>
              {theme.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Font preview
        <select
          aria-label="Font preview"
          value={uiFont}
          onChange={(event) => setUIFont(event.target.value as UIFont)}
        >
          <option value="ibm-plex-mono">IBM Plex Mono</option>
          <option value="system">System UI</option>
        </select>
      </label>
      <button onClick={() => setLeftVisible((visible) => !visible)}>
        {leftVisible ? 'Unmount left' : 'Mount left'}
      </button>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          height: '94vh',
          gap: 12,
        }}
      >
        <section aria-label="Left Agent" style={{ minHeight: 0, minWidth: 0 }}>
          {leftVisible && (
            <InlineVkAgentChat
              workspaceId="workspace-1"
              surfaceId="left"
              onViewDiffs={() => setDiffRequested('left:workspace-1')}
              theme={{ mode }}
              workspacePreview={
                <WorkspacePreviewMenu
                  workspaceId="workspace-1"
                  onConfigure={() => setConfigured('workspace-1')}
                />
              }
            />
          )}
        </section>
        <section aria-label="Right Agent" style={{ minHeight: 0, minWidth: 0 }}>
          <InlineVkAgentChat
            workspaceId={rightWorkspace}
            surfaceId="right"
            onViewDiffs={() => setDiffRequested(`right:${rightWorkspace}`)}
            theme={{ mode }}
            workspacePreview={
              <WorkspacePreviewMenu
                workspaceId={rightWorkspace}
                onConfigure={() => setConfigured(rightWorkspace)}
              />
            }
          />
        </section>
      </div>
      {configured && <p>Configure requested for {configured}</p>}
      {diffRequested && <p>Diff requested for {diffRequested}</p>}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <HeroUIProvider>
    <Harness />
  </HeroUIProvider>,
);
