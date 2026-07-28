export type FileNode = {
  id: string;
  type: 'file';
  name: string;
  content: string; // text content, or dataURL for binary
  isBinary: boolean;
  language: string;
};

export type FolderNode = {
  id: string;
  type: 'folder';
  name: string;
  isOpen: boolean;
  children: TreeNode[];
};

export type TreeNode = FileNode | FolderNode;

export type Framework = 'static' | 'react-ts';

export function isFolder(n: TreeNode): n is FolderNode {
  return n.type === 'folder';
}

export function languageFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'html': return 'html';
    case 'css': return 'css';
    case 'js': return 'javascript';
    case 'jsx': return 'javascript';
    case 'ts': return 'typescript';
    case 'tsx': return 'typescript';
    case 'json': return 'json';
    case 'md': return 'markdown';
    case 'svg': return 'xml';
    default: return 'plaintext';
  }
}

const BINARY_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp']);

export function isBinaryName(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return BINARY_EXT.has(ext);
}
