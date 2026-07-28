import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { FileNode, FolderNode, Framework, TreeNode } from '../types';
import { isBinaryName, isFolder, languageFromName } from '../types';
import { createTreeForFramework } from './initialTree';
import {
  findNode, findParent, getPath, insertNode, makeId, moveNode, removeNode, updateNode,
} from './vfs';

function findDefaultFile(root: FolderNode): FileNode | null {
  let found: FileNode | null = null;
  function walk(folder: FolderNode) {
    for (const c of folder.children) {
      if (c.type === 'file') {
        if (!found) found = c;
        if (c.name.toLowerCase() === 'app.tsx') found = c;
      } else {
        walk(c);
      }
    }
  }
  walk(root);
  return found;
}

interface VfsContextValue {
  root: FolderNode;
  framework: Framework;
  switchFramework: (fw: Framework) => void;
  tabs: string[];
  activeId: string | null;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  openFile: (id: string) => void;
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
  updateFileContent: (id: string, content: string) => void;
  createFile: (parentId: string, name: string, content?: string, isBinary?: boolean) => string;
  createFolder: (parentId: string, name: string) => string;
  renameNode: (id: string, name: string) => void;
  deleteNode: (id: string) => void;
  toggleFolder: (id: string) => void;
  moveInto: (id: string, newParentId: string) => void;
  path: (id: string) => string;
  getNode: (id: string) => TreeNode | null;
  importFiles: (parentId: string, files: FileList | File[]) => Promise<void>;
}

const VfsContext = createContext<VfsContextValue | null>(null);

function uniqueName(folder: FolderNode, base: string): string {
  const existing = new Set(folder.children.map((c) => c.name));
  if (!existing.has(base)) return base;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  let i = 2;
  while (existing.has(`${stem} ${i}${ext}`)) i += 1;
  return `${stem} ${i}${ext}`;
}

function readFileAsync(file: File): Promise<{ content: string; isBinary: boolean }> {
  const binary = isBinaryName(file.name);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve({ content: String(reader.result), isBinary: binary });
    if (binary) reader.readAsDataURL(file);
    else reader.readAsText(file);
  });
}

export function VfsProvider({ children }: { children: ReactNode }) {
  const [framework, setFramework] = useState<Framework>('static');
  const [root, setRoot] = useState<FolderNode>(() => createTreeForFramework('static'));
  const [tabs, setTabs] = useState<string[]>(() => {
    const first = findDefaultFile(root);
    return first ? [first.id] : [];
  });
  const [activeId, setActiveId] = useState<string | null>(tabs[0] ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(activeId);

  const switchFramework = useCallback((fw: Framework) => {
    const tree = createTreeForFramework(fw);
    const first = findDefaultFile(tree);
    setRoot(tree);
    setFramework(fw);
    setTabs(first ? [first.id] : []);
    setActiveId(first?.id ?? null);
    setSelectedId(first?.id ?? null);
  }, []);

  const openFile = useCallback((id: string) => {
    setTabs((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setActiveId(id);
    setSelectedId(id);
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t !== id);
      setActiveId((cur) => {
        if (cur !== id) return cur;
        const idx = prev.indexOf(id);
        return next[idx - 1] ?? next[0] ?? null;
      });
      return next;
    });
  }, []);

  const setActive = useCallback((id: string) => {
    setActiveId(id);
    setSelectedId(id);
  }, []);

  const updateFileContent = useCallback((id: string, content: string) => {
    setRoot((prev) => updateNode(prev, id, { content } as Partial<TreeNode>));
  }, []);

  const createFile = useCallback((parentId: string, name: string, content = '', isBinary = false) => {
    let newId = '';
    setRoot((prev) => {
      const parent = findNode(prev, parentId);
      const targetFolder = parent && isFolder(parent) ? parent : prev;
      const finalName = uniqueName(targetFolder, name);
      const file: FileNode = {
        id: makeId('file'), type: 'file', name: finalName, content, isBinary,
        language: languageFromName(finalName),
      };
      newId = file.id;
      return insertNode(prev, targetFolder.id, file);
    });
    return newId;
  }, []);

  const createFolder = useCallback((parentId: string, name: string) => {
    let newId = '';
    setRoot((prev) => {
      const parent = findNode(prev, parentId);
      const targetFolder = parent && isFolder(parent) ? parent : prev;
      const finalName = uniqueName(targetFolder, name);
      const folder: FolderNode = {
        id: makeId('folder'), type: 'folder', name: finalName, isOpen: true, children: [],
      };
      newId = folder.id;
      return insertNode(prev, targetFolder.id, folder);
    });
    return newId;
  }, []);

  const renameNode = useCallback((id: string, name: string) => {
    setRoot((prev) => {
      const node = findNode(prev, id);
      if (!node) return prev;
      const patch: Partial<TreeNode> = node.type === 'file'
        ? { name, language: languageFromName(name) } as Partial<FileNode>
        : { name };
      return updateNode(prev, id, patch);
    });
  }, []);

  const deleteNode = useCallback((id: string) => {
    setRoot((prev) => removeNode(prev, id));
    setTabs((prev) => prev.filter((t) => t !== id));
    setActiveId((cur) => (cur === id ? null : cur));
  }, []);

  const toggleFolder = useCallback((id: string) => {
    setRoot((prev) => {
      const node = findNode(prev, id);
      if (!node || !isFolder(node)) return prev;
      return updateNode(prev, id, { isOpen: !node.isOpen } as Partial<FolderNode>);
    });
  }, []);

  const moveInto = useCallback((id: string, newParentId: string) => {
    setRoot((prev) => {
      const parent = findParent(prev, id);
      if (parent && parent.id === newParentId) return prev;
      return moveNode(prev, id, newParentId);
    });
  }, []);

  const path = useCallback((id: string) => getPath(root, id), [root]);
  const getNode = useCallback((id: string) => findNode(root, id), [root]);

  const importFiles = useCallback(async (parentId: string, files: FileList | File[]) => {
    const list = Array.from(files);
    const results = await Promise.all(list.map(async (f) => ({
      name: f.name,
      ...(await readFileAsync(f)),
    })));
    setRoot((prev) => {
      let next = prev;
      for (const r of results) {
        const targetFolder = findNode(next, parentId);
        const folder = targetFolder && isFolder(targetFolder) ? targetFolder : next;
        const finalName = uniqueName(folder, r.name);
        const file: FileNode = {
          id: makeId('file'), type: 'file', name: finalName, content: r.content,
          isBinary: r.isBinary, language: languageFromName(finalName),
        };
        next = insertNode(next, folder.id, file);
      }
      return next;
    });
  }, []);

  const value = useMemo<VfsContextValue>(() => ({
    root, framework, switchFramework, tabs, activeId, selectedId, setSelectedId, openFile, closeTab, setActive,
    updateFileContent, createFile, createFolder, renameNode, deleteNode, toggleFolder,
    moveInto, path, getNode, importFiles,
  }), [root, framework, switchFramework, tabs, activeId, selectedId, openFile, closeTab, setActive, updateFileContent,
    createFile, createFolder, renameNode, deleteNode, toggleFolder, moveInto, path, getNode, importFiles]);

  return <VfsContext.Provider value={value}>{children}</VfsContext.Provider>;
}

export function useVfs(): VfsContextValue {
  const ctx = useContext(VfsContext);
  if (!ctx) throw new Error('useVfs must be used within VfsProvider');
  return ctx;
}
