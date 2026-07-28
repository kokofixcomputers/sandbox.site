import { useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent } from 'react';
import { useVfs } from '../vfs/VfsContext';
import type { FolderNode, TreeNode } from '../types';
import { isFolder } from '../types';
import {
  IconFolder, IconFolderOpen, IconFileImage, IconFileCode, IconFile,
  IconFilePlus, IconFolderPlus, IconUpload, IconTrash,
} from './Icons';

const VFS_MIME = 'application/x-vfs-id';

function NodeIcon({ node }: { node: TreeNode }) {
  if (node.type === 'folder') return node.isOpen ? <IconFolderOpen /> : <IconFolder />;
  const ext = node.name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'html': case 'css': case 'js': case 'json': case 'ts': case 'tsx': case 'jsx':
      return <IconFileCode />;
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'webp': case 'svg': case 'ico':
      return <IconFileImage />;
    default:
      return <IconFile />;
  }
}

function Node({ node, depth }: { node: TreeNode; depth: number }) {
  const vfs = useVfs();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.name);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isSelected = vfs.selectedId === node.id;
  const isActive = vfs.activeId === node.id;

  function commitRename() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== node.name) vfs.renameNode(node.id, trimmed);
    setEditing(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') commitRename();
    if (e.key === 'Escape') { setDraft(node.name); setEditing(false); }
  }

  function onDragStart(e: DragEvent) {
    e.dataTransfer.setData(VFS_MIME, node.id);
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(e: DragEvent) {
    if (node.type !== 'folder') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes(VFS_MIME) ? 'move' : 'copy';
    setDragOver(true);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (node.type !== 'folder') return;
    const draggedId = e.dataTransfer.getData(VFS_MIME);
    if (draggedId) {
      vfs.moveInto(draggedId, node.id);
      return;
    }
    if (e.dataTransfer.files?.length) {
      void vfs.importFiles(node.id, e.dataTransfer.files);
    }
  }

  function handleClick() {
    vfs.setSelectedId(node.id);
    if (node.type === 'folder') vfs.toggleFolder(node.id);
    else vfs.openFile(node.id);
  }

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (node.type === 'folder' && node.children.length > 0) {
      if (!window.confirm(`Delete "${node.name}" and everything inside it?`)) return;
    }
    vfs.deleteNode(node.id);
  }

  return (
    <div className="tree-node-wrap">
      <div
        className={`tree-row${isSelected ? ' selected' : ''}${isActive ? ' active' : ''}${dragOver ? ' drag-over' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 10}px` }}
        draggable
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={handleClick}
        onDoubleClick={() => setEditing(true)}
      >
        <span className="tree-icon"><NodeIcon node={node} /></span>
        {editing ? (
          <input
            ref={inputRef}
            className="tree-rename-input"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={onKeyDown}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="tree-name">{node.name}</span>
        )}
        <button className="tree-delete-btn" onClick={handleDelete} title="Delete" aria-label={`Delete ${node.name}`}>
          <IconTrash width={11} height={11} />
        </button>
      </div>
      {node.type === 'folder' && node.isOpen && (
        <div className="tree-children">
          {node.children.map((child) => (
            <Node key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree() {
  const vfs = useVfs();
  const [rootDragOver, setRootDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function targetFolderId(): string {
    const sel = vfs.selectedId ? vfs.getNode(vfs.selectedId) : null;
    if (sel && isFolder(sel)) return sel.id;
    if (sel) {
      const parent = findParentId(vfs.root, sel.id);
      return parent ?? 'root';
    }
    return 'root';
  }

  function findParentId(folder: FolderNode, id: string): string | null {
    for (const c of folder.children) {
      if (c.id === id) return folder.id;
      if (isFolder(c)) {
        const found = findParentId(c, id);
        if (found) return found;
      }
    }
    return null;
  }

  function handleNewFile() {
    const id = vfs.createFile(targetFolderId(), 'untitled.html', '<!-- new file -->\n');
    vfs.openFile(id);
  }

  function handleNewFolder() {
    vfs.createFolder(targetFolderId(), 'new-folder');
  }

  function onRootDragOver(e: DragEvent) {
    e.preventDefault();
    setRootDragOver(true);
  }

  function onRootDrop(e: DragEvent) {
    e.preventDefault();
    setRootDragOver(false);
    const draggedId = e.dataTransfer.getData(VFS_MIME);
    if (draggedId) {
      vfs.moveInto(draggedId, 'root');
      return;
    }
    if (e.dataTransfer.files?.length) {
      void vfs.importFiles('root', e.dataTransfer.files);
    }
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">EXPLORER</span>
        <div className="sidebar-actions">
          <button onClick={handleNewFile} title="New file" aria-label="New file"><IconFilePlus /></button>
          <button onClick={handleNewFolder} title="New folder" aria-label="New folder"><IconFolderPlus /></button>
          <button onClick={() => fileInputRef.current?.click()} title="Upload files" aria-label="Upload files"><IconUpload /></button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void vfs.importFiles(targetFolderId(), e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      </div>
      <div
        className={`tree-scroll${rootDragOver ? ' drag-over-root' : ''}`}
        onDragOver={onRootDragOver}
        onDragLeave={() => setRootDragOver(false)}
        onDrop={onRootDrop}
      >
        {vfs.root.children.map((child) => (
          <Node key={child.id} node={child} depth={0} />
        ))}
        <div className="tree-drop-hint">Drop files here to import</div>
      </div>
    </aside>
  );
}
