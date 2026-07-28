import type { FileNode, FolderNode, TreeNode } from '../types';
import { isFolder } from '../types';

export const SANDBOX_MESSAGE_TAG = '__sandboxPreview';

interface FlatFile {
  path: string;
  node: FileNode;
}

function flatten(folder: FolderNode, prefix: string, out: FlatFile[]) {
  for (const child of folder.children) {
    const path = prefix ? `${prefix}/${child.name}` : child.name;
    if (isFolder(child)) {
      flatten(child, path, out);
    } else {
      out.push({ path, node: child });
    }
  }
}

/** Flattens the whole tree to a path -> {content, isBinary} snapshot, used to diff renders. */
export function snapshotFiles(root: FolderNode): Map<string, { content: string; isBinary: boolean }> {
  const files: FlatFile[] = [];
  flatten(root, '', files);
  const map = new Map<string, { content: string; isBinary: boolean }>();
  for (const f of files) map.set(f.path, { content: f.node.content, isBinary: f.node.isBinary });
  return map;
}

export function pathOf(root: FolderNode, target: TreeNode): string | null {
  const files: FlatFile[] = [];
  flatten(root, '', files);
  const match = files.find((f) => f.node.id === target.id);
  return match ? match.path : null;
}

function dirOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

function resolveRelative(baseDir: string, rel: string): string | null {
  if (!rel) return null;
  if (/^(https?:)?\/\//i.test(rel) || rel.startsWith('data:') || rel.startsWith('blob:') || rel.startsWith('#')) {
    return null; // external / already resolved, leave untouched
  }
  const cleanRel = rel.split('?')[0].split('#')[0];
  const baseParts = baseDir ? baseDir.split('/') : [];
  const relParts = cleanRel.split('/');
  const stack = cleanRel.startsWith('/') ? [] : [...baseParts];
  for (const part of relParts) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

function extOf(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? '';
}

function base64Encode(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

function buildByPath(root: FolderNode): Map<string, FlatFile> {
  const files: FlatFile[] = [];
  flatten(root, '', files);
  const byPath = new Map<string, FlatFile>();
  for (const f of files) byPath.set(f.path, f);
  return byPath;
}

function resolveAssetUrl(byPath: Map<string, FlatFile>, baseDir: string, ref: string): string | null {
  const resolved = resolveRelative(baseDir, ref);
  if (!resolved) return null;
  const target = byPath.get(resolved);
  if (!target) return null;
  if (target.node.isBinary) return target.node.content; // already a data: URL
  const type = extOf(resolved) === 'css' ? 'text/css' : 'text/plain';
  return `data:${type};charset=utf-8;base64,${base64Encode(target.node.content)}`;
}

function inlineCss(byPath: Map<string, FlatFile>, content: string, dir: string): string {
  return content.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, _quote, ref) => {
    const url = resolveAssetUrl(byPath, dir, ref);
    return url ? `url("${url}")` : match;
  });
}

/** Renders a single CSS file's content (with url() references inlined) for a hot-swap update. */
export function renderCssForPath(root: FolderNode, path: string): string | null {
  const byPath = buildByPath(root);
  const target = byPath.get(path);
  if (!target || target.node.isBinary) return null;
  return inlineCss(byPath, target.node.content, dirOf(path));
}

/** Sends a CSS hot-swap message into the preview iframe; no-op if no matching <style> tag exists. */
export function postCssHotUpdate(iframe: HTMLIFrameElement | null, path: string, css: string): void {
  iframe?.contentWindow?.postMessage({ [SANDBOX_MESSAGE_TAG]: true, type: 'css-update', path, css }, '*');
}

// Sandboxed iframes without allow-same-origin have a null/opaque origin and
// cannot dereference blob: URLs for subresources. Binary assets are already
// stored as data: URLs (origin-independent), so only text assets (css/js)
// need special handling: they are inlined directly into the document instead
// of referenced by URL.
export interface BuiltPreview {
  html: string;
  revoke: () => void;
}

const HOT_SWAP_BOOTSTRAP = `
(function () {
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data['${SANDBOX_MESSAGE_TAG}'] !== true) return;
    if (data.type === 'css-update' && typeof data.path === 'string') {
      var selector = 'style[data-sandbox-path="' + data.path.replace(/"/g, '\\\\"') + '"]';
      var el = document.querySelector(selector);
      if (el) el.textContent = data.css;
    }
  });
})();
`;

// Babel Standalone's automatic <script type="text/babel" data-presets="..."> scanner
// has proven unreliable for combined TypeScript+JSX (it silently drops the typescript
// preset in some builds). Transpiling explicitly via Babel.transform with a filename
// (so preset-typescript reliably parses both TS syntax and JSX) sidesteps that.
const TS_TRANSPILE_BOOTSTRAP = `
(function () {
  if (!window.Babel) return;
  var nodes = document.querySelectorAll('script[data-sandbox-lang]');
  nodes.forEach(function (node) {
    var path = node.getAttribute('data-sandbox-path') || ('sandbox.' + node.getAttribute('data-sandbox-lang'));
    try {
      var out = Babel.transform(node.textContent, {
        presets: [['typescript', { isTSX: true, allExtensions: true }], 'react'],
        filename: path,
      }).code;
      var script = document.createElement('script');
      script.textContent = out;
      node.replaceWith(script);
    } catch (err) {
      console.error('Sandbox transpile error in ' + path, err);
    }
  });
})();
`;

export function buildPreviewDocument(root: FolderNode, htmlNode: FileNode): BuiltPreview {
  const byPath = buildByPath(root);

  const htmlPath = pathOf(root, htmlNode) ?? '';
  const htmlDir = dirOf(htmlPath);
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlNode.content, 'text/html');

  // Inline <link rel="stylesheet" href="..."> as tagged <style> tags so they
  // can be targeted for hot CSS swaps without a full iframe reload.
  doc.querySelectorAll('link[rel="stylesheet"]').forEach((el) => {
    const href = el.getAttribute('href');
    if (!href) return;
    const resolved = resolveRelative(htmlDir, href);
    if (!resolved) return;
    const target = byPath.get(resolved);
    if (!target || target.node.isBinary) return;
    const style = doc.createElement('style');
    style.setAttribute('data-sandbox-path', resolved);
    style.textContent = inlineCss(byPath, target.node.content, dirOf(resolved));
    el.replaceWith(style);
  });

  // Inline <script src="..."> with the raw source. .ts/.tsx/.jsx files have no
  // bundler behind them: they're emitted as inert placeholder tags (an
  // unrecognized `type` keeps the browser from executing them) and picked up
  // by TS_TRANSPILE_BOOTSTRAP, which explicitly runs them through Babel.
  const BABEL_EXTS = new Set(['ts', 'tsx', 'jsx']);
  let needsTranspileBootstrap = false;
  doc.querySelectorAll('script[src]').forEach((el) => {
    const src = el.getAttribute('src');
    if (!src) return;
    const resolved = resolveRelative(htmlDir, src);
    if (!resolved) return;
    const target = byPath.get(resolved);
    if (!target || target.node.isBinary) return;
    const script = doc.createElement('script');
    for (const attr of Array.from(el.attributes)) {
      if (attr.name === 'src' || attr.name === 'type') continue;
      script.setAttribute(attr.name, attr.value);
    }
    const ext = extOf(resolved);
    if (BABEL_EXTS.has(ext)) {
      script.setAttribute('type', 'application/x-sandbox-source');
      script.setAttribute('data-sandbox-lang', ext);
      script.setAttribute('data-sandbox-path', resolved);
      needsTranspileBootstrap = true;
    }
    script.textContent = target.node.content.replace(/<\/script/gi, '<\\/script');
    el.replaceWith(script);
  });

  // Binary assets referenced directly from the markup use data: URLs.
  function rewriteAttr(el: Element, attr: string) {
    const val = el.getAttribute(attr);
    if (!val) return;
    const url = resolveAssetUrl(byPath, htmlDir, val);
    if (url) el.setAttribute(attr, url);
  }

  doc.querySelectorAll('link[rel~="icon"]').forEach((el) => rewriteAttr(el, 'href'));
  doc.querySelectorAll('img[src]').forEach((el) => rewriteAttr(el, 'src'));
  doc.querySelectorAll('source[src]').forEach((el) => rewriteAttr(el, 'src'));
  doc.querySelectorAll('audio[src], video[src]').forEach((el) => rewriteAttr(el, 'src'));

  const bootstrap = doc.createElement('script');
  bootstrap.textContent = HOT_SWAP_BOOTSTRAP;
  doc.head.appendChild(bootstrap);

  if (needsTranspileBootstrap) {
    const transpile = doc.createElement('script');
    transpile.textContent = TS_TRANSPILE_BOOTSTRAP;
    doc.body.appendChild(transpile);
  }

  const serialized = `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;

  return {
    html: serialized,
    revoke: () => {},
  };
}
