import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { useVfs } from '../vfs/VfsContext';
import {
  buildPreviewDocument, snapshotFiles, pathOf, renderCssForPath, postCssHotUpdate,
  type BuiltPreview,
} from '../vfs/buildPreview';
import type { FileNode, FolderNode } from '../types';
import { isFolder } from '../types';
import {
  IconPhone, IconTablet, IconLaptop, IconDesktop, IconFluid, IconRotate, IconReload, IconClose,
} from './Icons';

const LIVE_DEBOUNCE_MS = 220;

interface DevicePreset {
  label: string;
  width: number | null; // null = fill available space
  height: number | null;
  Icon: ComponentType<{ width?: number; height?: number }>;
}

const PRESETS: DevicePreset[] = [
  { label: 'Mobile', width: 375, height: 667, Icon: IconPhone },
  { label: 'Tablet', width: 768, height: 1024, Icon: IconTablet },
  { label: 'Laptop', width: 1280, height: 800, Icon: IconLaptop },
  { label: 'Desktop', width: 1536, height: 960, Icon: IconDesktop },
  { label: 'Fluid', width: null, height: null, Icon: IconFluid },
];

function findHtmlFile(root: FolderNode): FileNode | null {
  let indexAtRoot: FileNode | null = null;
  let anyHtml: FileNode | null = null;
  function walk(folder: FolderNode) {
    for (const child of folder.children) {
      if (isFolder(child)) walk(child);
      else if (child.name.toLowerCase().endsWith('.html')) {
        if (!anyHtml) anyHtml = child;
        if (folder.id === root.id && child.name.toLowerCase() === 'index.html') indexAtRoot = child;
      }
    }
  }
  walk(root);
  return indexAtRoot ?? anyHtml;
}

interface PreviewProps {
  onExit: () => void;
  exitLabel?: string;
  variant?: 'full' | 'split';
  live?: boolean;
}

export function Preview({ onExit, exitLabel = 'Close', variant = 'full', live = false }: PreviewProps) {
  const vfs = useVfs();
  const [preset, setPreset] = useState<DevicePreset>(() => (variant === 'split' ? PRESETS[4] : PRESETS[2]));
  const [customWidth, setCustomWidth] = useState<number | null>(null);
  const [rotated, setRotated] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [built, setBuilt] = useState<BuiltPreview | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const resizingRef = useRef(false);

  const prevFilesRef = useRef<Map<string, { content: string; isBinary: boolean }> | null>(null);
  const prevHtmlPathRef = useRef<string | null>(null);
  const prevReloadTickRef = useRef(reloadTick);

  const activeNode = vfs.activeId ? vfs.getNode(vfs.activeId) : null;
  const htmlNode = useMemo(() => {
    if (activeNode && activeNode.type === 'file' && activeNode.name.toLowerCase().endsWith('.html')) {
      return activeNode as FileNode;
    }
    return findHtmlFile(vfs.root);
  }, [activeNode, vfs.root]);

  // HMR-style update: if only CSS file content changed since the last render,
  // hot-swap the matching <style> tag inside the iframe via postMessage
  // instead of rebuilding + reloading the whole document. Anything else
  // (HTML/JS edits, added/removed files, a different html target, or a
  // manual reload click) falls back to a full rebuild.
  useEffect(() => {
    if (!htmlNode) {
      setBuilt(null);
      prevFilesRef.current = null;
      prevHtmlPathRef.current = null;
      return;
    }

    const files = snapshotFiles(vfs.root);
    const htmlPath = pathOf(vfs.root, htmlNode) ?? '';
    const forceReload = reloadTick !== prevReloadTickRef.current;
    const prev = prevFilesRef.current;

    if (!forceReload && prev && prevHtmlPathRef.current === htmlPath) {
      const allPaths = new Set([...prev.keys(), ...files.keys()]);
      let structural = false;
      const changedCssPaths: string[] = [];
      for (const p of allPaths) {
        const a = prev.get(p);
        const b = files.get(p);
        if (!a || !b) { structural = true; break; }
        if (a.content === b.content && a.isBinary === b.isBinary) continue;
        if (b.isBinary || !p.toLowerCase().endsWith('.css')) { structural = true; break; }
        changedCssPaths.push(p);
      }
      if (!structural) {
        if (changedCssPaths.length > 0) {
          for (const p of changedCssPaths) {
            const css = renderCssForPath(vfs.root, p);
            if (css !== null) postCssHotUpdate(iframeRef.current, p, css);
          }
        }
        prevFilesRef.current = files;
        return; // no full rebuild needed
      }
    }

    const delay = live && prev ? LIVE_DEBOUNCE_MS : 0;
    const timer = window.setTimeout(() => {
      setBuilt(buildPreviewDocument(vfs.root, htmlNode));
      prevFilesRef.current = files;
      prevHtmlPathRef.current = htmlPath;
      prevReloadTickRef.current = reloadTick;
    }, delay);
    return () => window.clearTimeout(timer);
  }, [vfs.root, htmlNode, reloadTick, live]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!resizingRef.current || !containerRef.current) return;
      const bounds = containerRef.current.getBoundingClientRect();
      const w = Math.round((e.clientX - bounds.left) * 2);
      setCustomWidth(Math.max(240, Math.min(w, bounds.width - 8)));
    }
    function onUp() { resizingRef.current = false; }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const baseWidth = preset.width;
  const baseHeight = preset.height;
  const fluidHeight = baseHeight === null; // Fluid preset: height always fills the stage
  const effectiveWidth = customWidth ?? (rotated ? baseHeight : baseWidth);
  const effectiveHeight = fluidHeight ? null : (rotated ? baseWidth : baseHeight);
  const isFluid = effectiveWidth === null;

  function selectPreset(p: DevicePreset) {
    setPreset(p);
    setCustomWidth(null);
    setRotated(false);
  }

  return (
    <div className="preview-mode">
      <div className="preview-toolbar">
        <div className="preview-toolbar-left">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              className={`preset-btn${preset.label === p.label && customWidth === null ? ' active' : ''}`}
              onClick={() => selectPreset(p)}
              title={p.width ? `${p.width} × ${p.height}` : 'Fill available space'}
            >
              <p.Icon width={13} height={13} />{p.label}
            </button>
          ))}
          {preset.width && (
            <button className="preset-btn rotate-btn" onClick={() => setRotated((r) => !r)} title="Rotate">
              <IconRotate width={13} height={13} />
            </button>
          )}
        </div>
        <div className="preview-toolbar-right">
          {live && (
            <span className="live-badge" title="Preview updates automatically as you type">
              <span className="live-dot" /> LIVE
            </span>
          )}
          <span className="preview-dimensions">
            {isFluid ? 'fluid' : `${effectiveWidth} × ${effectiveHeight ?? '—'}`}
          </span>
          <button className="preview-icon-btn" onClick={() => setReloadTick((t) => t + 1)} title="Reload preview">
            <IconReload width={13} height={13} />
          </button>
          <button className="preview-close-btn" onClick={onExit} title="Back to editor">
            <IconClose width={12} height={12} /> {exitLabel}
          </button>
        </div>
      </div>

      <div className="preview-stage" ref={containerRef}>
        {!htmlNode && (
          <div className="preview-empty">No HTML file found. Create an index.html to preview your site.</div>
        )}
        {htmlNode && built && (
          <div
            className={`preview-frame-shell${isFluid ? ' fluid-width' : ''}${fluidHeight ? ' fluid-height' : ''}`}
            style={{
              width: effectiveWidth ?? undefined,
              height: effectiveHeight ?? undefined,
            }}
          >
            <iframe
              ref={iframeRef}
              key={htmlNode.id + reloadTick}
              title="preview"
              srcDoc={built.html}
              sandbox="allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock"
            />
            <div
              className="preview-resize-handle"
              onMouseDown={(e) => {
                e.preventDefault();
                if (customWidth === null && containerRef.current) {
                  const bounds = containerRef.current.getBoundingClientRect();
                  setCustomWidth(Math.round(bounds.width - 48));
                }
                resizingRef.current = true;
              }}
              title="Drag to resize width"
            />
          </div>
        )}
      </div>
    </div>
  );
}
