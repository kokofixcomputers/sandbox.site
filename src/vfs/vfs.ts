import type { FolderNode, TreeNode } from '../types';
import { isFolder } from '../types';

let idCounter = 0;
export function makeId(prefix = 'n'): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`;
}

export function cloneTree<T extends TreeNode>(node: T): T {
  if (isFolder(node)) {
    return { ...node, children: node.children.map(cloneTree) } as T;
  }
  return { ...node };
}

export function findNode(root: FolderNode, id: string): TreeNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    if (child.id === id) return child;
    if (isFolder(child)) {
      const found = findNode(child, id);
      if (found) return found;
    }
  }
  return null;
}

export function findNodeByPath(root: FolderNode, path: string): TreeNode | null {
  const segments = path.split('/').filter(Boolean);
  let current: TreeNode = root;
  for (const segment of segments) {
    if (!isFolder(current)) return null;
    const children: TreeNode[] = current.children;
    const next: TreeNode | undefined = children.find((c) => c.name === segment);
    if (!next) return null;
    current = next;
  }
  return current;
}

export function findParent(root: FolderNode, id: string): FolderNode | null {
  for (const child of root.children) {
    if (child.id === id) return root;
    if (isFolder(child)) {
      const found = findParent(child, id);
      if (found) return found;
    }
  }
  return null;
}

export function getPath(root: FolderNode, id: string): string {
  const parts: string[] = [];
  function walk(node: TreeNode, trail: string[]): boolean {
    if (node.id === id) {
      parts.push(...trail, node.name);
      return true;
    }
    if (isFolder(node)) {
      for (const child of node.children) {
        if (walk(child, [...trail, node.name === 'root' ? '' : node.name].filter(Boolean))) return true;
      }
    }
    return false;
  }
  walk(root, []);
  return parts.join('/');
}

export function removeNode(root: FolderNode, id: string): FolderNode {
  const next = cloneTree(root);
  function walk(folder: FolderNode) {
    folder.children = folder.children.filter((c) => c.id !== id);
    folder.children.forEach((c) => { if (isFolder(c)) walk(c); });
  }
  walk(next);
  return next;
}

export function insertNode(root: FolderNode, parentId: string, node: TreeNode): FolderNode {
  const next = cloneTree(root);
  function walk(folder: FolderNode): boolean {
    if (folder.id === parentId) {
      folder.children.push(node);
      folder.isOpen = true;
      return true;
    }
    for (const c of folder.children) {
      if (isFolder(c) && walk(c)) return true;
    }
    return false;
  }
  walk(next);
  return next;
}

export function updateNode(root: FolderNode, id: string, patch: Partial<TreeNode>): FolderNode {
  const next = cloneTree(root);
  function walk(folder: FolderNode): boolean {
    for (let i = 0; i < folder.children.length; i++) {
      const c = folder.children[i];
      if (c.id === id) {
        folder.children[i] = { ...c, ...patch } as TreeNode;
        return true;
      }
      if (isFolder(c) && walk(c)) return true;
    }
    return false;
  }
  if (root.id === id) {
    Object.assign(next, patch);
  } else {
    walk(next);
  }
  return next;
}

export function moveNode(root: FolderNode, id: string, newParentId: string): FolderNode {
  const node = findNode(root, id);
  if (!node || node.id === newParentId) return root;
  // prevent dropping a folder into itself or its descendant
  if (isFolder(node)) {
    const descendant = findNode(node, newParentId);
    if (descendant) return root;
  }
  const withoutNode = removeNode(root, id);
  return insertNode(withoutNode, newParentId, node);
}

export function isDescendantOrSelf(root: FolderNode, ancestorId: string, id: string): boolean {
  const node = findNode(root, ancestorId);
  if (!node || !isFolder(node)) return false;
  if (node.id === id) return true;
  return !!findNode(node, id) && (function walk(n: TreeNode): boolean {
    if (n.id === id) return true;
    if (isFolder(n)) return n.children.some(walk);
    return false;
  })(node);
}
