// v86's public API (create_file/read_file) covers writes and reads, but has no
// directory-listing call, which is why the terminal used to run `find`/`md5sum`
// over the serial console to discover files — directly colliding with whatever
// the user was typing.
//
// v86 does expose its internal 9p filesystem object as `emulator.fs9p` (used
// internally to implement create_file/read_file — see their source,
// FS.prototype.{GetChildren,Search,IsDirectory,CreateDirectory,DeleteNode,GetInode}).
// It isn't in the published .d.ts, but it's a plain, stable object property,
// not a private field, so it's reachable directly and lets us list/create
// directories/delete entries entirely in-process — no shell, no serial I/O,
// zero chance of colliding with interactive typing.

export interface Fs9pInode {
  size: number;
}

export interface Fs9pFilesystem {
  GetChildren(id: number): string[];
  Search(parentId: number, name: string): number;
  IsDirectory(id: number): boolean;
  CreateDirectory(name: string, parentId: number): number;
  DeleteNode(path: string): void;
  SearchPath(path: string): { id: number };
  GetInode(id: number): Fs9pInode;
}

const ROOT_ID = 0;

export function getFs9p(emulator: unknown): Fs9pFilesystem | null {
  const fs9p = (emulator as { fs9p?: Fs9pFilesystem }).fs9p;
  return fs9p ?? null;
}

/** Recursively lists every file path and every directory path (both relative to the 9p share root). */
export function listFs9pTree(fs9p: Fs9pFilesystem): { files: string[]; dirs: string[] } {
  const files: string[] = [];
  const dirs: string[] = [];
  function recurse(dirId: number, prefix: string) {
    for (const name of fs9p.GetChildren(dirId)) {
      const id = fs9p.Search(dirId, name);
      if (id === -1) continue;
      const path = prefix ? `${prefix}/${name}` : name;
      if (fs9p.IsDirectory(id)) {
        dirs.push(path);
        recurse(id, path);
      } else {
        files.push(path);
      }
    }
  }
  recurse(ROOT_ID, '');
  return { files, dirs };
}

/** Creates any missing directories along dirPath, e.g. "a/b/c". */
export function ensureGuestDir(fs9p: Fs9pFilesystem, dirPath: string): void {
  if (!dirPath) return;
  let parentId = ROOT_ID;
  for (const segment of dirPath.split('/').filter(Boolean)) {
    let id = fs9p.Search(parentId, segment);
    if (id === -1) id = fs9p.CreateDirectory(segment, parentId);
    parentId = id;
  }
}

/**
 * v86's public `read_file()` incorrectly rejects with FileNotFoundError for a
 * file that legitimately exists but has never had anything written to it
 * (its internal data buffer is `undefined`, and the wrapper treats that as
 * "missing" rather than "empty") — e.g. straight after `touch`. Checking the
 * inode size directly here lets callers special-case that instead of losing
 * the file entirely.
 */
export function getGuestFileSize(fs9p: Fs9pFilesystem, path: string): number | null {
  const { id } = fs9p.SearchPath(path);
  if (id === -1) return null;
  return fs9p.GetInode(id).size;
}
