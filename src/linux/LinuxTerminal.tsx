import { useEffect, useRef, useState } from 'react';
import { V86 } from 'v86';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useVfs } from '../vfs/VfsContext';
import { snapshotFiles } from '../vfs/buildPreview';
import { findNodeByPath } from '../vfs/vfs';
import { isBinaryName, isFolder } from '../types';
import { mimeForExt } from './mimeTypes';
import { getFs9p, listFs9pTree, ensureGuestDir, getGuestFileSize, type Fs9pFilesystem } from './fs9pBridge';
import { IconReload } from '../components/Icons';

// This Buildroot image auto-mounts the 9p share at /mnt on boot (see its own
// login banner: "Files send via emulator appear in /mnt/") — purely a UX nicety
// for the interactive shell (`cd` there so relative paths work); all of our own
// sync logic below talks to the fs9p object directly and doesn't care where
// (or whether) the guest has mounted it.
const MOUNT_POINT = '/mnt';
const IDLE_SETTLE_MS = 450;
const POLL_INTERVAL_MS = 1000;
const BASE = import.meta.env.BASE_URL;

type Status = 'booting' | 'mounting' | 'ready' | 'error';

function base64ToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[a-zA-Z]|\x1b[()#][0-9A-Za-z]|\x1b[@-Z\\-_]/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

/** A tiny fixed-size async mutex so automated commands never overlap on the wire. */
function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task, task);
    tail = run.catch(() => {});
    return run;
  };
}

export function LinuxTerminal() {
  const vfs = useVfs();
  const containerRef = useRef<HTMLDivElement>(null);
  const emulatorRef = useRef<V86 | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const bootedRef = useRef(false);
  const bootResolvedRef = useRef(false);
  const forceContinueRef = useRef<(() => Promise<void>) | null>(null);

  const outputTailRef = useRef('');
  const lastByteAtRef = useRef(0);
  const capturingRef = useRef(false);
  const captureBufRef = useRef('');
  const enqueueRef = useRef(createSerialQueue());

  const lastPushedRef = useRef<Map<string, { content: string; isBinary: boolean }>>(new Map());
  const lastGuestDirsRef = useRef<Set<string>>(new Set());
  const pollTimerRef = useRef<number | null>(null);
  const syncingInRef = useRef(false);

  const [status, setStatus] = useState<Status>('booting');
  const [errorMessage, setErrorMessage] = useState('');
  const [autoSync, setAutoSync] = useState(true);
  const autoSyncRef = useRef(autoSync);
  useEffect(() => { autoSyncRef.current = autoSync; }, [autoSync]);

  function isIdle(): boolean {
    const tail = stripAnsi(outputTailRef.current).trimEnd();
    const settled = Date.now() - lastByteAtRef.current > IDLE_SETTLE_MS;
    const last = tail.slice(-1);
    return settled && (last === '#' || last === '$' || last === '>' || last === '%');
  }

  function waitForIdle(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        if (isIdle()) return resolve(true);
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(tick, 150);
      };
      tick();
    });
  }

  /**
   * Sends a shell command and captures its output — used only for the
   * one-time boot detection and the one-time `cd` right after mounting.
   * All ongoing file sync goes through fs9p directly (see below) and never
   * touches the serial console, so it can't collide with anything typed here.
   */
  function runCommand(cmd: string, timeoutMs = 8000): Promise<string | null> {
    return enqueueRef.current(async () => {
      const emulator = emulatorRef.current;
      if (!emulator) return null;
      await waitForIdle(4000);
      captureBufRef.current = '';
      capturingRef.current = true;
      emulator.serial0_send(`${cmd}\n`);
      await waitForIdle(timeoutMs);
      capturingRef.current = false;
      const lines = stripAnsi(captureBufRef.current).split(/\r?\n/);
      if (lines.length && lines[0].trim() === cmd.trim()) lines.shift();
      if (lines.length) lines.pop();
      return lines.join('\n');
    });
  }

  function currentFs9p(): Fs9pFilesystem | null {
    return emulatorRef.current ? getFs9p(emulatorRef.current) : null;
  }

  async function pushFileToGuest(path: string, content: string, isBinary: boolean) {
    const emulator = emulatorRef.current;
    if (!emulator) return;
    const bytes = isBinary ? base64ToBytes(content) : new TextEncoder().encode(content);
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const fs9p = currentFs9p();
    if (dir && fs9p) ensureGuestDir(fs9p, dir);
    await emulator.create_file(path, bytes);
  }

  async function pushAllToGuest() {
    const files = snapshotFiles(vfs.root);
    for (const [path, file] of files) {
      await pushFileToGuest(path, file.content, file.isBinary);
    }
    lastPushedRef.current = files;
  }

  async function syncHostChangesToGuest() {
    if (syncingInRef.current) return;
    const files = snapshotFiles(vfs.root);
    const prev = lastPushedRef.current;
    const allPaths = new Set([...prev.keys(), ...files.keys()]);
    for (const path of allPaths) {
      const before = prev.get(path);
      const after = files.get(path);
      if (after && (!before || before.content !== after.content || before.isBinary !== after.isBinary)) {
        await pushFileToGuest(path, after.content, after.isBinary);
      } else if (before && !after) {
        currentFs9p()?.DeleteNode(path);
      }
    }
    lastPushedRef.current = files;
  }

  async function readGuestFile(path: string): Promise<{ content: string; isBinary: boolean } | null> {
    const binary = isBinaryName(path);
    // v86's read_file() rejects with FileNotFoundError for a file that exists
    // but is empty (e.g. straight after `touch` — its data buffer is never
    // allocated until something is written), so short-circuit on size 0
    // rather than letting that reject and losing the file entirely.
    const fs9p = currentFs9p();
    if (fs9p) {
      const size = getGuestFileSize(fs9p, path);
      if (size === null) return null; // genuinely gone
      if (size === 0) return { content: binary ? `data:${mimeForExt(path.split('.').pop() ?? '')};base64,` : '', isBinary: binary };
    }
    try {
      const bytes = await emulatorRef.current!.read_file(path);
      const content = binary
        ? `data:${mimeForExt(path.split('.').pop() ?? '')};base64,${bytesToBase64(bytes)}`
        : new TextDecoder().decode(bytes);
      return { content, isBinary: binary };
    } catch {
      return null; // missing/unreadable — most likely deleted in the guest
    }
  }

  /**
   * Pulls guest-side changes (new files, edits, deletions — cp/mv/sed, all of
   * it) into the VFS tree. Listing comes from fs9p directly (in-process, no
   * shell), and content comes from the public read_file API — no serial I/O
   * anywhere in this path, so it's safe to run on a tight interval without
   * ever interrupting whatever's being typed in the terminal.
   */
  async function syncFromGuest() {
    if (syncingInRef.current) return;
    const fs9p = currentFs9p();
    if (!fs9p) return;
    syncingInRef.current = true;
    try {
      const { files, dirs } = listFs9pTree(fs9p);

      // Bare/empty directories only ever get created in the VFS as a side
      // effect of syncing a file inside them, so walk them explicitly too —
      // otherwise a plain `mkdir` (or a dir containing only empty files)
      // never shows up.
      const guestDirs = new Set(dirs);
      for (const dir of guestDirs) ensureFolderPath(dir);
      for (const dir of lastGuestDirsRef.current) {
        if (guestDirs.has(dir)) continue;
        const node = findNodeByPath(vfs.root, dir);
        if (node && isFolder(node) && node.children.length === 0) vfs.deleteNode(node.id);
      }
      lastGuestDirsRef.current = guestDirs;

      const guestPaths = new Set(files);
      const knownPaths = new Set(lastPushedRef.current.keys());
      const allPaths = new Set([...guestPaths, ...knownPaths]);

      for (const path of allPaths) {
        if (guestPaths.has(path)) {
          const before = lastPushedRef.current.get(path);
          const result = await readGuestFile(path);
          if (!result) continue;
          if (!before || before.content !== result.content || before.isBinary !== result.isBinary) {
            applyGuestFileToVfs(path, result.content, result.isBinary);
            lastPushedRef.current.set(path, result);
          }
        } else if (knownPaths.has(path)) {
          removeVfsPath(path);
          lastPushedRef.current.delete(path);
        }
      }
      setErrorMessage('');
    } catch (err) {
      console.error('Terminal sync failed', err);
    } finally {
      syncingInRef.current = false;
    }
  }

  function ensureFolderPath(dirPath: string): string {
    if (!dirPath) return 'root';
    const segments = dirPath.split('/').filter(Boolean);
    let currentId = 'root';
    let built = '';
    for (const segment of segments) {
      built = built ? `${built}/${segment}` : segment;
      const existing = findNodeByPath(vfs.root, built);
      if (existing && isFolder(existing)) {
        currentId = existing.id;
      } else {
        currentId = vfs.createFolder(currentId, segment);
      }
    }
    return currentId;
  }

  function applyGuestFileToVfs(path: string, content: string, binary: boolean) {
    const existing = findNodeByPath(vfs.root, path);
    if (existing && existing.type === 'file') {
      vfs.updateFileContent(existing.id, content);
      return;
    }
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const name = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path;
    const folderId = ensureFolderPath(dir);
    vfs.createFile(folderId, name, content, binary);
  }

  function removeVfsPath(path: string) {
    const existing = findNodeByPath(vfs.root, path);
    if (existing) vfs.deleteNode(existing.id);
  }

  useEffect(() => {
    if (bootedRef.current || !containerRef.current) return;
    bootedRef.current = true;

    class CapturingTerminal extends Terminal {
      constructor(...args: ConstructorParameters<typeof Terminal>) {
        super(...args);
        termRef.current = this;
        const fitAddon = new FitAddon();
        this.loadAddon(fitAddon);
        fitAddonRef.current = fitAddon;
      }
    }

    const emulator = new V86({
      wasm_path: `${BASE}v86/v86.wasm`,
      memory_size: 128 * 1024 * 1024,
      vga_memory_size: 2 * 1024 * 1024,
      bios: { url: `${BASE}v86/seabios.bin` },
      vga_bios: { url: `${BASE}v86/vgabios.bin` },
      bzimage: { url: `${BASE}v86/buildroot-bzimage68.bin`, async: false },
      cmdline: 'tsc=reliable mitigations=off random.trust_cpu=on',
      filesystem: {},
      autostart: true,
      disable_keyboard: true,
      disable_mouse: true,
      serial_console: {
        type: 'xtermjs',
        container: containerRef.current,
        xterm_lib: CapturingTerminal as unknown as Function,
      },
    });
    emulatorRef.current = emulator;

    emulator.add_listener('serial0-output-byte', (byte: number) => {
      lastByteAtRef.current = Date.now();
      const ch = String.fromCharCode(byte);
      outputTailRef.current = (outputTailRef.current + ch).slice(-200);
      if (capturingRef.current) captureBufRef.current += ch;
    });

    const beginMountSequence = async () => {
      if (bootResolvedRef.current) return;
      bootResolvedRef.current = true;
      try {
        setStatus('mounting');
        await pushAllToGuest();
        // Land the interactive shell inside the shared directory so the user's
        // own typed commands (ls, cp, mv, sed …) work on relative paths. Purely
        // cosmetic — sync itself doesn't depend on this.
        await runCommand(`cd ${MOUNT_POINT}`);
        setStatus('ready');
        pollTimerRef.current = window.setInterval(() => {
          if (autoSyncRef.current) void syncFromGuest();
        }, POLL_INTERVAL_MS);
      } catch (err) {
        setStatus('error');
        setErrorMessage(err instanceof Error ? err.message : String(err));
      }
    };
    forceContinueRef.current = beginMountSequence;

    (async () => {
      const gotPrompt = await waitForIdle(60000);
      if (bootResolvedRef.current) return;
      if (!gotPrompt) {
        setStatus('error');
        setErrorMessage(
          "Couldn't confirm the shell prompt automatically — if you can already see and use the "
          + 'terminal below, click "It\'s already booted" to continue.',
        );
        return;
      }
      void beginMountSequence();
    })();

    const resizeObserver = new ResizeObserver(() => fitAddonRef.current?.fit());
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
      void emulatorRef.current?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push host-side edits (Monaco, file tree ops) into the guest once it's mounted.
  useEffect(() => {
    if (status !== 'ready') return;
    const timer = window.setTimeout(() => { void syncHostChangesToGuest(); }, 400);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vfs.root, status]);

  return (
    <div className="linux-terminal">
      <div className="linux-terminal-toolbar">
        <span className={`linux-status linux-status-${status}`}>
          {status === 'booting' && 'Booting Linux…'}
          {status === 'mounting' && 'Mounting shared filesystem…'}
          {status === 'ready' && `Ready — files shared at ${MOUNT_POINT}`}
          {status === 'error' && `Error: ${errorMessage}`}
        </span>
        <div className="linux-terminal-actions">
          {(status === 'booting' || status === 'error') && (
            <button
              className="preview-icon-btn"
              onClick={() => void forceContinueRef.current?.()}
              title="Skip boot detection and mount the shared filesystem now"
            >
              It's already booted
            </button>
          )}
          <label className="linux-autosync-toggle">
            <input type="checkbox" checked={autoSync} onChange={(e) => setAutoSync(e.target.checked)} />
            Auto-sync
          </label>
          <button
            className="preview-icon-btn"
            onClick={() => void syncFromGuest()}
            title="Pull guest filesystem changes now"
            disabled={status !== 'ready'}
          >
            <IconReload width={13} height={13} /> Sync now
          </button>
        </div>
      </div>
      <div className="linux-terminal-screen" ref={containerRef} />
    </div>
  );
}
