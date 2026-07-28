import { useEffect, useRef, useState } from 'react';
import { useVfs } from '../vfs/VfsContext';
import type { Framework } from '../types';
import { IconLayers, IconAtom, IconChevronDown } from './Icons';

const OPTIONS: { key: Framework; label: string; hint: string; Icon: typeof IconLayers }[] = [
  { key: 'static', label: 'Static', hint: 'HTML / CSS / JS', Icon: IconLayers },
  { key: 'react-ts', label: 'React + TypeScript', hint: 'JSX transpiled in-browser via Babel', Icon: IconAtom },
];

export function FrameworkSwitcher() {
  const vfs = useVfs();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = OPTIONS.find((o) => o.key === vfs.framework) ?? OPTIONS[0];

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function choose(fw: Framework) {
    setOpen(false);
    if (fw === vfs.framework) return;
    const label = OPTIONS.find((o) => o.key === fw)?.label ?? fw;
    if (window.confirm(`Switch to ${label}? This replaces every file in the current project.`)) {
      vfs.switchFramework(fw);
    }
  }

  return (
    <div className="framework-switch" ref={rootRef}>
      <button className="framework-switch-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <current.Icon width={13} height={13} />
        <span>{current.label}</span>
        <IconChevronDown width={11} height={11} />
      </button>
      {open && (
        <div className="framework-switch-menu" role="listbox">
          {OPTIONS.map((o) => (
            <button
              key={o.key}
              role="option"
              aria-selected={o.key === vfs.framework}
              className={`framework-switch-option${o.key === vfs.framework ? ' selected' : ''}`}
              onClick={() => choose(o.key)}
            >
              <o.Icon width={16} height={16} />
              <span className="framework-switch-option-text">
                <span className="framework-switch-option-label">{o.label}</span>
                <span className="framework-switch-option-hint">{o.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
