import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { InlineVkAgentChat, InlineVkCreateWorkspace } from '@vibe/inline-chat';
import { WorkspacePreviewMenu } from '../../../src/components/WorkspacePreviewMenu';
import { PreviewRunConfigsPanel } from '../../../src/components/PreviewRunConfigsPanel';
import '../../../src/styles.css';

function Harness() {
  const [leftVisible, setLeftVisible] = useState(true);
  const [configured, setConfigured] = useState('');
  const [diffRequested, setDiffRequested] = useState('');
  const rightWorkspace =
    new URLSearchParams(location.search).get('right') ?? 'workspace-1';
  if (new URLSearchParams(location.search).has('preview-config')) {
    return <PreviewRunConfigsPanel workspaceId="workspace-1" />;
  }
  if (new URLSearchParams(location.search).has('create')) {
    return (
      <div style={{ height: '100vh' }}>
        <InlineVkCreateWorkspace surfaceId="create" />
      </div>
    );
  }
  return (
    <>
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

createRoot(document.getElementById('root')!).render(<Harness />);
