import { useRef, useState } from 'react';
import { VfsProvider } from './vfs/VfsContext';
import { FileTree } from './components/FileTree';
import { EditorTabs } from './components/EditorTabs';
import { EditorPane } from './components/EditorPane';
import { Preview } from './components/Preview';
import { FrameworkSwitcher } from './components/FrameworkSwitcher';
import { LinuxTerminal } from './linux/LinuxTerminal';
import { IconCode, IconSplit, IconPlay, IconTerminal, IconChevronDown } from './components/Icons';
import './App.css';

type Mode = 'edit' | 'split' | 'preview';

const MODES: { key: Mode; label: string; Icon: typeof IconCode }[] = [
  { key: 'edit', label: 'Code', Icon: IconCode },
  { key: 'split', label: 'Split', Icon: IconSplit },
  { key: 'preview', label: 'Preview', Icon: IconPlay },
];

const MIN_PANE_FRACTION = 0.2;
const DEFAULT_TERMINAL_HEIGHT = 280;
const MIN_TERMINAL_HEIGHT = 120;
const TERMINAL_COLLAPSE_THRESHOLD = 60;
const TERMINAL_BAR_HEIGHT = 30;

function Shell() {
  const [mode, setMode] = useState<Mode>('edit');
  const [splitFraction, setSplitFraction] = useState(0.5);
  const [terminalStarted, setTerminalStarted] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(DEFAULT_TERMINAL_HEIGHT);

  const workspaceRef = useRef<HTMLDivElement>(null);
  const splitPaneRef = useRef<HTMLDivElement>(null);
  const draggingSplitRef = useRef(false);
  const draggingTerminalRef = useRef(false);

  function toggleTerminal() {
    setTerminalStarted(true);
    setTerminalOpen((open) => !open);
  }

  function onSplitDragStart(e: React.MouseEvent) {
    e.preventDefault();
    draggingSplitRef.current = true;
    const onMove = (ev: MouseEvent) => {
      if (!draggingSplitRef.current || !splitPaneRef.current) return;
      const bounds = splitPaneRef.current.getBoundingClientRect();
      const fraction = (ev.clientX - bounds.left) / bounds.width;
      setSplitFraction(Math.min(1 - MIN_PANE_FRACTION, Math.max(MIN_PANE_FRACTION, fraction)));
    };
    const onUp = () => {
      draggingSplitRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function onTerminalDragStart(e: React.MouseEvent) {
    e.preventDefault();
    draggingTerminalRef.current = true;
    const onMove = (ev: MouseEvent) => {
      if (!draggingTerminalRef.current || !workspaceRef.current) return;
      const bounds = workspaceRef.current.getBoundingClientRect();
      // Height is measured from the bottom bar's top edge, so the panel
      // (plus its fixed-height bottom bar) tracks the cursor directly.
      const height = bounds.bottom - TERMINAL_BAR_HEIGHT - ev.clientY;
      if (height < TERMINAL_COLLAPSE_THRESHOLD) {
        setTerminalOpen(false);
        return;
      }
      const max = bounds.height - TERMINAL_BAR_HEIGHT - 120;
      setTerminalOpen(true);
      setTerminalHeight(Math.min(max, Math.max(MIN_TERMINAL_HEIGHT, height)));
    };
    const onUp = () => {
      draggingTerminalRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

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
          <button
            className={`terminal-toggle-btn${terminalOpen ? ' active' : ''}`}
            onClick={toggleTerminal}
            aria-pressed={terminalOpen}
            title="Toggle terminal panel"
          >
            <IconTerminal width={12} height={12} />
            Terminal
          </button>
        </div>
      </header>
      <div className="app-body">
        <FileTree />
        <div className="workspace" ref={workspaceRef}>
          <main className={`main-panel${mode === 'split' ? ' split' : ''}`} ref={splitPaneRef}>
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
                <div className="split-pane split-pane-editor" style={{ flex: `0 0 ${splitFraction * 100}%` }}>
                  <EditorTabs />
                  <EditorPane />
                </div>
                <div className="split-drag-handle-v" onMouseDown={onSplitDragStart} title="Drag to resize" />
                <div className="split-pane split-pane-preview">
                  <Preview onExit={() => setMode('edit')} exitLabel="Exit Split" variant="split" live />
                </div>
              </>
            )}
          </main>
          {/* Kept mounted once started (instead of unmounting when collapsed) so the
              booted Linux VM keeps running in the background rather than rebooting
              every time the terminal panel is reopened. Dragging the handle down
              past the collapse threshold snaps it shut; the bar underneath stays
              put either way so there's always something to drag/click back open. */}
          {terminalStarted && (
            <>
              <div className="terminal-drag-handle-h" onMouseDown={onTerminalDragStart} title="Drag to resize" />
              <div
                className={`terminal-host${terminalOpen ? '' : ' terminal-host-collapsed'}`}
                style={{ height: terminalOpen ? terminalHeight : 0 }}
              >
                <LinuxTerminal />
              </div>
              <button
                className="terminal-bar"
                onClick={() => setTerminalOpen((open) => !open)}
                aria-expanded={terminalOpen}
                title={terminalOpen ? 'Collapse terminal' : 'Expand terminal'}
              >
                <IconTerminal width={13} height={13} />
                <span>Terminal</span>
                <IconChevronDown
                  width={12}
                  height={12}
                  className={`terminal-bar-chevron${terminalOpen ? ' open' : ''}`}
                />
              </button>
            </>
          )}
        </div>
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
