import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FilePlus, FolderPlus, ArrowUpDown, ChevronsDownUp } from "lucide-react";
import { basename, type NoteFile } from "../vault";

export type SortMode = "name-asc" | "name-desc" | "mtime-desc" | "mtime-asc" | "ctime-desc" | "ctime-asc";
const SORT_LABELS: Record<SortMode, string> = {
  "name-asc": "파일 이름 (A → Z)",
  "name-desc": "파일 이름 (Z → A)",
  "mtime-desc": "수정 시각 (최신순)",
  "mtime-asc": "수정 시각 (오래된순)",
  "ctime-desc": "생성 시각 (최신순)",
  "ctime-asc": "생성 시각 (오래된순)",
};

interface Props {
  files: NoteFile[];
  folders: string[];
  activePath: string | null;
  onOpen(path: string, newTab: boolean): void;
  onNewNote(folder: string): void;
  onNewFolder(parent: string): void;
  onRename(path: string, isFolder: boolean): void;
  onDelete(path: string, isFolder: boolean): void;
  onMove(from: string, toFolder: string): void;
}

interface TreeNode {
  name: string;
  path: string;
  folder: boolean;
  file?: NoteFile;
  children: TreeNode[];
}

export default function FileExplorer(p: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortMode>("name-asc");
  const [sortOpen, setSortOpen] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; folder: boolean } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const tree = useMemo(() => {
    const root: TreeNode = { name: "", path: "", folder: true, children: [] };
    const folderNode = new Map<string, TreeNode>([["", root]]);
    const ensure = (path: string): TreeNode => {
      if (folderNode.has(path)) return folderNode.get(path)!;
      const parent = ensure(path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
      const node: TreeNode = { name: path.split("/").pop()!, path, folder: true, children: [] };
      parent.children.push(node);
      folderNode.set(path, node);
      return node;
    };
    p.folders.forEach(ensure);
    p.files.forEach((f) => {
      const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
      ensure(dir).children.push({ name: basename(f.path), path: f.path, folder: false, file: f, children: [] });
    });
    const cmp = (a: TreeNode, b: TreeNode) => {
      if (a.folder !== b.folder) return a.folder ? -1 : 1; // 폴더가 먼저
      if (a.folder || sort.startsWith("name")) {
        const r = a.name.localeCompare(b.name, "ko", { numeric: true });
        return sort === "name-desc" ? -r : r;
      }
      const key = sort.startsWith("mtime") ? "mtime" : "ctime";
      const r = a.file![key] - b.file![key];
      return sort.endsWith("desc") ? -r : r;
    };
    const sortRec = (n: TreeNode) => {
      n.children.sort(cmp);
      n.children.forEach(sortRec);
    };
    sortRec(root);
    return root;
  }, [p.files, p.folders, sort]);

  const toggle = (path: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      n.has(path) ? n.delete(path) : n.add(path);
      return n;
    });

  const render = (node: TreeNode, depth: number): React.ReactNode =>
    node.children.map((c) => (
      <div key={c.path}>
        <div
          className={`tree-item${!c.folder && c.path === p.activePath ? " is-active" : ""}${dragOver === c.path ? " is-drop-target" : ""}`}
          style={{ paddingLeft: 8 + depth * 16 }}
          draggable
          onDragStart={(e) => e.dataTransfer.setData("text/rea-path", c.path)}
          onDragOver={(e) => {
            if (c.folder) {
              e.preventDefault();
              setDragOver(c.path);
            }
          }}
          onDragLeave={() => setDragOver(null)}
          onDrop={(e) => {
            setDragOver(null);
            const from = e.dataTransfer.getData("text/rea-path");
            if (c.folder && from && from !== c.path) p.onMove(from, c.path);
          }}
          onClick={(e) => (c.folder ? toggle(c.path) : p.onOpen(c.path, e.metaKey || e.ctrlKey))}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, path: c.path, folder: c.folder });
          }}
          title={c.path}
        >
          {c.folder ? (
            <span className="tree-chevron">{collapsed.has(c.path) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</span>
          ) : (
            <span className="tree-chevron" />
          )}
          <span className={c.folder ? "tree-folder-name" : "tree-file-name"}>{c.name}</span>
        </div>
        {c.folder && !collapsed.has(c.path) && render(c, depth + 1)}
      </div>
    ));

  return (
    <div
      className="file-explorer"
      onClick={() => {
        setMenu(null);
        setSortOpen(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const from = e.dataTransfer.getData("text/rea-path");
        if (from && from.includes("/")) p.onMove(from, "");
      }}
    >
      <div className="nav-buttons">
        <button title="새 노트" onClick={() => p.onNewNote("")}><FilePlus size={16} /></button>
        <button title="새 폴더" onClick={() => p.onNewFolder("")}><FolderPlus size={16} /></button>
        <button
          title="정렬 순서 변경"
          onClick={(e) => {
            e.stopPropagation();
            setSortOpen((o) => !o);
          }}
        >
          <ArrowUpDown size={16} />
        </button>
        <button title="모두 접기" onClick={() => setCollapsed(new Set(p.folders))}><ChevronsDownUp size={16} /></button>
        {sortOpen && (
          <div className="menu" style={{ top: 34, left: 60 }} onClick={(e) => e.stopPropagation()}>
            {(Object.keys(SORT_LABELS) as SortMode[]).map((k) => (
              <div key={k} className={`menu-item${k === sort ? " is-selected" : ""}`} onClick={() => { setSort(k); setSortOpen(false); }}>
                {SORT_LABELS[k]}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="tree">{render(tree, 0)}</div>
      {menu && (
        <div className="menu" style={{ position: "fixed", top: menu.y, left: menu.x }}>
          {menu.folder && <div className="menu-item" onClick={() => { p.onNewNote(menu.path); setMenu(null); }}>새 노트</div>}
          {menu.folder && <div className="menu-item" onClick={() => { p.onNewFolder(menu.path); setMenu(null); }}>새 폴더</div>}
          {!menu.folder && <div className="menu-item" onClick={() => { p.onOpen(menu.path, true); setMenu(null); }}>새 탭에서 열기</div>}
          <div className="menu-item" onClick={() => { p.onRename(menu.path, menu.folder); setMenu(null); }}>이름 바꾸기</div>
          <div className="menu-item is-warning" onClick={() => { p.onDelete(menu.path, menu.folder); setMenu(null); }}>삭제</div>
        </div>
      )}
    </div>
  );
}
