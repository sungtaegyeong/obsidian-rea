// 볼트 저장소 추상화: 샘플(메모리), 브라우저 폴더(File System Access API), Electron(로컬 파일)
export interface NoteFile {
  path: string; // 볼트 루트 기준 상대 경로, 예: "공부/REA.md"
  content: string;
  mtime: number;
  ctime: number;
}

export interface VaultData {
  files: NoteFile[];
  folders: string[];
}

export interface VaultBackend {
  name: string;
  kind: "memory" | "browser" | "electron";
  load(): Promise<VaultData>;
  write(path: string, content: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  remove(path: string, isFolder: boolean): Promise<void>;
  rename(from: string, to: string, isFolder: boolean): Promise<void>;
}

// ---------- 샘플 볼트 (메모리) ----------
const sampleModules = import.meta.glob("../sample-vault/**/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export function createSampleVault(): VaultBackend {
  return {
    name: "sample-vault",
    kind: "memory",
    async load() {
      const now = Date.now();
      const files: NoteFile[] = Object.entries(sampleModules).map(([key, content], i) => ({
        path: key.replace("../sample-vault/", ""),
        content,
        mtime: now - i * 60_000,
        ctime: now - i * 3_600_000,
      }));
      const folders = new Set<string>();
      files.forEach((f) => parentFolders(f.path).forEach((p) => folders.add(p)));
      return { files, folders: [...folders] };
    },
    async write() {},
    async mkdir() {},
    async remove() {},
    async rename() {},
  };
}

// ---------- 브라우저 폴더 (Chrome File System Access API) ----------
type DirHandle = FileSystemDirectoryHandle & {
  entries(): AsyncIterable<[string, FileSystemHandle]>;
};

export const browserFolderSupported = typeof window !== "undefined" && "showDirectoryPicker" in window;

export async function createBrowserVault(): Promise<VaultBackend> {
  const root = (await (window as unknown as { showDirectoryPicker: (o?: object) => Promise<DirHandle> }).showDirectoryPicker({
    mode: "readwrite",
  })) as DirHandle;

  async function getDir(path: string, create = false): Promise<DirHandle> {
    let dir: DirHandle = root;
    for (const part of path.split("/").filter(Boolean)) {
      dir = (await dir.getDirectoryHandle(part, { create })) as DirHandle;
    }
    return dir;
  }
  const split = (p: string) => {
    const i = p.lastIndexOf("/");
    return i < 0 ? ["", p] : [p.slice(0, i), p.slice(i + 1)];
  };

  async function walk(dir: DirHandle, prefix: string, out: VaultData) {
    for await (const [name, handle] of dir.entries()) {
      if (name.startsWith(".")) continue; // .obsidian, .git 등 숨김 폴더 제외
      const path = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === "directory") {
        out.folders.push(path);
        await walk(handle as DirHandle, path, out);
      } else if (name.endsWith(".md")) {
        const file = await (handle as FileSystemFileHandle).getFile();
        out.files.push({ path, content: await file.text(), mtime: file.lastModified, ctime: file.lastModified });
      }
    }
  }

  const backend: VaultBackend = {
    name: root.name,
    kind: "browser",
    async load() {
      const out: VaultData = { files: [], folders: [] };
      await walk(root, "", out);
      return out;
    },
    async write(path, content) {
      const [dirPath, name] = split(path);
      const dir = await getDir(dirPath, true);
      const fh = await dir.getFileHandle(name, { create: true });
      const w = await (fh as FileSystemFileHandle & { createWritable(): Promise<WritableStream & { write(d: string): Promise<void>; close(): Promise<void> }> }).createWritable();
      await w.write(content);
      await w.close();
    },
    async mkdir(path) {
      await getDir(path, true);
    },
    async remove(path, isFolder) {
      const [dirPath, name] = split(path);
      const dir = await getDir(dirPath);
      await dir.removeEntry(name, { recursive: isFolder });
    },
    async rename(from, to, isFolder) {
      if (isFolder) {
        // 폴더 이동: 하위 파일을 새 경로로 복사한 뒤 원래 폴더 삭제
        const data: VaultData = { files: [], folders: [] };
        await walk(await getDir(from), from, data);
        await backend.mkdir(to);
        for (const f of data.files) await backend.write(to + f.path.slice(from.length), f.content);
        await backend.remove(from, true);
        return;
      }
      const [dirPath, name] = split(from);
      const file = await (await (await getDir(dirPath)).getFileHandle(name)).getFile();
      await backend.write(to, await file.text());
      await backend.remove(from, false);
    },
  };
  return backend;
}

// ---------- Electron (preload가 노출한 window.reaFs) ----------
interface ReaFs {
  pickVault(): Promise<string | null>;
  load(root: string): Promise<VaultData>;
  write(root: string, path: string, content: string): Promise<void>;
  mkdir(root: string, path: string): Promise<void>;
  remove(root: string, path: string): Promise<void>;
  rename(root: string, from: string, to: string): Promise<void>;
}
declare global {
  interface Window {
    reaFs?: ReaFs;
  }
}
export const electronSupported = typeof window !== "undefined" && !!window.reaFs;

export async function createElectronVault(): Promise<VaultBackend | null> {
  const fs = window.reaFs!;
  const root = await fs.pickVault();
  if (!root) return null;
  return {
    name: root.split(/[\\/]/).pop() || root,
    kind: "electron",
    load: () => fs.load(root),
    write: (p, c) => fs.write(root, p, c),
    mkdir: (p) => fs.mkdir(root, p),
    remove: (p) => fs.remove(root, p),
    rename: (a, b) => fs.rename(root, a, b),
  };
}

// ---------- 경로 도우미 ----------
export function parentFolders(path: string): string[] {
  const parts = path.split("/");
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join("/"));
  return out;
}
export const basename = (path: string) => path.split("/").pop()!.replace(/\.md$/, "");
export const dirname = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
