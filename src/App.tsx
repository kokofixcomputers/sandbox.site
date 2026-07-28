import { useState } from 'react';
import { VfsProvider } from './vfs/VfsContext';
import { FileTree } from './components/FileTree';
import { EditorTabs } from './components/EditorTabs';
import { EditorPane } from './components/EditorPane';
import { Preview } from './components/Preview';
import { FrameworkSwitcher } from './components/FrameworkSwitcher';
import { IconCode, IconSplit, IconPlay } from './components/Icons';
import './App.css';

type Mode = 'edit' | 'split' | 'preview';

const MODES: { key: Mode; label: string; Icon: typeof IconCode }[] = [
  { key: 'edit', label: 'Code', Icon: IconCode },
  { key: 'split', label: 'Split', Icon: IconSplit },
  { key: 'preview', label: 'Preview', Icon: IconPlay },
];

function Shell() {
  const [mode, setMode] = useState<Mode>('edit');

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="brand">
          <span className="brand-mark">⌁</span>
          <span className="brand-name">SANDBOX<span className="brand-accent">.SITE</span></span>
        </div>
        <div className="topbar-actions">
          <FrameworkSwitcher />
          <div className="mode-switch" role="tablist" aria-label="View mode">
            {MODES.map((m) => (
              <button
                key={m.key}
                role="tab"
                aria-selected={mode === m.key}
                className={`mode-switch-btn${mode === m.key ? ' active' : ''}`}
                onClick={() => setMode(m.key)}
              >
                <m.Icon width={12} height={12} />
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </header>
      <div className="app-body">
        <FileTree />
        <main className={`main-panel${mode === 'split' ? ' split' : ''}`}>
          {mode === 'edit' && (
            <>
              <EditorTabs />
              <EditorPane />
            </>
          )}
          {mode === 'preview' && (
            <Preview onExit={() => setMode('edit')} exitLabel="Back to Editor" variant="full" />
          )}
          {mode === 'split' && (
            <>
              <div className="split-pane split-pane-editor">
                <EditorTabs />
                <EditorPane />
              </div>
              <div className="split-pane split-pane-preview">
                <Preview onExit={() => setMode('edit')} exitLabel="Exit Split" variant="split" live />
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <VfsProvider>
      <Shell />
    </VfsProvider>
  );
}
