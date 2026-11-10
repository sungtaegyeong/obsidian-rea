import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FolderClosed, Search, Tags, Link2, ListTree, Waypoints, FileSearch, SquareTerminal, CalendarDays, Settings as SettingsIcon,
  FolderOpen, PanelLeft, PanelRight, Plus, X, Columns2, BookOpen, Pencil, NotebookPen, FilePlus, ArrowLeft, ArrowRight,
  ChevronsUpDown, Ellipsis, Trash2,
} from "lucide-react";
import Editor, { type EditorHandle } from "./components/Editor";
import ReadingView, { type ReadingHandle } from "./components/ReadingView";
import FileExplorer from "./components/FileExplorer";
import GraphView from "./components/GraphView";
import { SearchPanel, TagsPanel, BacklinksPanel, OutlinePanel } from "./components/SidePanels";
import { PickerModal, InputModal, ConfirmModal, type PickerItem } from "./components/Modals";
import SettingsModal, { loadSettings, saveSettings, type Settings } from "./components/SettingsModal";
import {
  basename, dirname, parentFolders, createSampleVault, createBrowserVault, createElectronVault, browserFolderSupported, electronSupported,
  type NoteFile, type VaultBackend,
} from "./vault";
import { countWords, parseWikiLinks, resolveLink, toggleTask } from "./markdown";

// ---------- 화면 상태 모델 ----------
type TabKind = "note" | "graph" | "empty";
interface Tab {
  id: string;
  kind: TabKind;
  path?: string;
  mode: "edit" | "read";
  back?: string[]; // 이 탭에서 이전에 연 노트들 (뒤로 가기)
  fwd?: string[];
}
interface Pane {
  id: string;
  tabs: Tab[];
  active: number;
}
type LeftView = "files" | "search" | "tags";
type RightView = "backlinks" | "outline" | "graph";
type Modal =
  | { type: "switcher" }
  | { type: "palette" }
  | { type: "settings" }
  | { type: "rename"; path: string; folder: boolean }
  | { type: "newfolder"; parent: string }
  | { type: "delete"; path: string; folder: boolean }
  | null;

const uid = () => Math.random().toString(36).slice(2, 9);
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl+";
// 브라우저는 ⌘T·⌘W·⌘N을 가로챌 수 없으므로 웹에서는 Alt 조합을 쓴다
const NATIVE = electronSupported;
if (typeof window !== "undefined" && window.reaFs?.frameless) document.documentElement.classList.add("rn-frameless");
const SAMPLE_KEY = "rea-notes:sample-vault";

interface Command {
  id: string;
  name: string;
  key?: string; // 예: "mod+o", "mod+shift+f"
  run(): void;
}
const ARROWS: Record<string, string> = { arrowleft: "←", arrowright: "→", arrowup: "↑", arrowdown: "↓" };
// spaced: 커맨드 팔레트의 단축키 표시처럼 키 사이를 띄운다 (예: "⌘ ⇧ F")
const keyLabel = (k?: string, spaced = false) =>
  k
    ?.split("+")
    .map((p) => (p === "mod" ? MOD : p === "shift" ? (isMac ? "⇧" : "Shift+") : p === "alt" ? (isMac ? "⌥" : "Alt+") : (ARROWS[p] ?? p.toUpperCase())))
    .map((p) => (spaced && isMac ? p.replace(/\+$/, "") : p))
    .join(spaced && isMac ? " " : "");

export default function App() {
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const setSettings = (s: Settings) => {
    setSettingsState(s);
    saveSettings(s);
  };

  const [backend, setBackend] = useState<VaultBackend | null>(null);
  const [files, setFiles] = useState<NoteFile[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [panes, setPanes] = useState<Pane[]>([]);
  const [activePane, setActivePane] = useState(0);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [leftView, setLeftView] = useState<LeftView>("files");
  const [rightView, setRightView] = useState<RightView>("backlinks");
  const [modal, setModal] = useState<Modal>(null);
  const [recent, setRecent] = useState<string[]>([]); // 최근에 연 노트 (빠른 전환의 기본 목록)
  const [moreMenu, setMoreMenu] = useState<number | null>(null); // "다른 옵션" 메뉴가 열린 창 번호
  useEffect(() => {
    if (moreMenu == null) return;
    const close = () => setMoreMenu(null);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [moreMenu]);
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const editors = useRef(new Map<string, EditorHandle>());
  const readers = useRef(new Map<string, ReadingHandle>());
  const pendingJump = useRef<{ tabId: string; line: number } | null>(null);
  const writeTimers = useRef(new Map<string, number>());
  const filesRef = useRef(files);
  filesRef.current = files;

  const notify = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  };

  // ---------- 볼트 열기 ----------
  const openVault = async (b: VaultBackend) => {
    let data = await b.load();
    if (b.kind === "memory") {
      try {
        const saved = localStorage.getItem(SAMPLE_KEY);
        if (saved) data = JSON.parse(saved);
      } catch {
        /* 저장본이 없거나 읽을 수 없으면 원본 샘플 사용 */
      }
    }
    setBackend(b);
    setFiles(data.files);
    setFolders(data.folders);
    const first = data.files.find((f) => basename(f.path) === "시작하기") ?? data.files[0];
    setPanes([{ id: uid(), tabs: [first ? { id: uid(), kind: "note", path: first.path, mode: settings.defaultMode } : { id: uid(), kind: "empty", mode: "edit" }], active: 0 }]);
    setActivePane(0);
    document.title = `${b.name} - REA Notes`;
  };

  // 샘플 볼트는 브라우저 저장소에 보관해서 새로고침해도 유지
  useEffect(() => {
    if (backend?.kind !== "memory") return;
    try {
      localStorage.setItem(SAMPLE_KEY, JSON.stringify({ files, folders }));
    } catch {
      /* 저장 불가 환경은 무시 */
    }
  }, [backend, files, folders]);

  // ---------- 테마 ----------
  useEffect(() => {
    const r = document.documentElement;
    r.dataset.theme = settings.theme;
    r.style.setProperty("--accent", settings.accent);
    r.style.setProperty("--font-text-size", settings.fontSize + "px");
  }, [settings]);

  // ---------- 파일 조작 ----------
  const exists = useCallback((target: string) => !!resolveLink(target, filesRef.current), []);

  const writeFile = (path: string, content: string, immediate = false) => {
    setFiles((fs) => fs.map((f) => (f.path === path ? { ...f, content, mtime: Date.now() } : f)));
    if (!backend) return;
    clearTimeout(writeTimers.current.get(path));
    const run = () => backend.write(path, content).catch((e) => notify("저장 실패: " + e.message));
    if (immediate) run();
    else writeTimers.current.set(path, window.setTimeout(run, 400));
  };

  const uniquePath = (folder: string, base: string) => {
    const taken = new Set(filesRef.current.map((f) => f.path));
    const pre = folder ? folder + "/" : "";
    let p = `${pre}${base}.md`;
    for (let i = 1; taken.has(p); i++) p = `${pre}${base} ${i}.md`;
    return p;
  };

  const createNote = async (folder: string, name = "제목 없음", content = "", where: "current" | "new" = "current") => {
    const path = uniquePath(folder, name);
    const now = Date.now();
    setFiles((fs) => [...fs, { path, content, mtime: now, ctime: now }]);
    setFolders((fs) => [...new Set([...fs, ...parentFolders(path)])]);
    await backend?.write(path, content);
    openFile(path, where === "new", "edit");
    return path;
  };

  const openDaily = () => {
    const d = new Date();
    const name = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const path = `일기/${name}.md`;
    if (filesRef.current.some((f) => f.path === path)) openFile(path, false);
    else createNote("일기", name, `# ${name}\n\n`);
  };

  // 이름 바꾸기 / 이동: 다른 노트의 [[링크]]도 함께 고친다
  const movePath = async (from: string, to: string, folder: boolean) => {
    if (from === to) return;
    if (filesRef.current.some((f) => f.path === to) || folders.includes(to)) return notify("같은 이름이 이미 있습니다");
    const map = new Map<string, string>();
    filesRef.current.forEach((f) => {
      if (folder ? f.path.startsWith(from + "/") : f.path === from) map.set(f.path, folder ? to + f.path.slice(from.length) : to);
    });
    const renamed = [...map].filter(([a, b]) => basename(a) !== basename(b));
    const changed: NoteFile[] = [];
    const next = filesRef.current.map((f) => {
      let content = f.content;
      renamed.forEach(([a, b]) => {
        const oldName = basename(a), newName = basename(b);
        content = content.replace(/\[\[([^\]\n|#]+)([^\]\n]*)\]\]/g, (m, target: string, rest: string) =>
          resolveLink(target.trim(), filesRef.current) === a ? `[[${target.includes("/") ? b.replace(/\.md$/, "") : newName}${rest}]]` : m,
        );
        void oldName;
      });
      const nf = { ...f, path: map.get(f.path) ?? f.path, content };
      if (content !== f.content) changed.push(nf);
      return nf;
    });
    setFiles(next);
    setFolders((fs) => {
      const moved = fs.map((p) => (folder && (p === from || p.startsWith(from + "/")) ? to + p.slice(from.length) : p));
      return [...new Set([...moved, ...parentFolders(folder ? to + "/x" : to)])];
    });
    setPanes((ps) => ps.map((p) => ({ ...p, tabs: p.tabs.map((t) => (t.path && map.has(t.path) ? { ...t, path: map.get(t.path) } : t)) })));
    try {
      await backend?.rename(from, to, folder);
      for (const f of changed) await backend?.write(f.path, f.content);
      if (renamed.length && changed.length) notify(`링크 ${changed.length}개 노트에서 갱신됨`);
    } catch (e) {
      notify("이름 바꾸기 실패: " + (e as Error).message);
    }
  };

  const deletePath = async (path: string, folder: boolean) => {
    const gone = (p: string) => (folder ? p === path || p.startsWith(path + "/") : p === path);
    setFiles((fs) => fs.filter((f) => !gone(f.path)));
    if (folder) setFolders((fs) => fs.filter((f) => !gone(f)));
    setPanes((ps) => ps.map((p) => ({ ...p, tabs: p.tabs.map((t) => (t.path && gone(t.path) ? { ...t, kind: "empty" as const, path: undefined } : t)) })));
    try {
      await backend?.remove(path, folder);
    } catch (e) {
      notify("삭제 실패: " + (e as Error).message);
    }
  };

  // ---------- 탭·분할 ----------
  const pane = panes[activePane];
  const tab = pane?.tabs[pane.active];
  const activeFile = tab?.kind === "note" ? files.find((f) => f.path === tab.path) ?? null : null;
  const activePath = activeFile?.path;
  useEffect(() => {
    if (activePath) setRecent((r) => [activePath, ...r.filter((x) => x !== activePath)].slice(0, 20));
  }, [activePath]);

  const updatePane = (i: number, fn: (p: Pane) => Pane) => setPanes((ps) => ps.map((p, j) => (j === i ? fn(p) : p)));

  function openFile(path: string, newTab: boolean, mode?: "edit" | "read", line?: number) {
    setPanes((ps) => {
      if (!ps.length) return ps;
      const i = Math.min(activePane, ps.length - 1);
      const p = ps[i];
      // 이미 열린 탭이 있으면 그 탭으로 이동
      const existing = p.tabs.findIndex((t) => t.path === path);
      let next: Pane;
      let tabId: string;
      if (existing >= 0 && (newTab || p.tabs[p.active].path !== path)) {
        tabId = p.tabs[existing].id;
        next = { ...p, active: existing, tabs: p.tabs.map((t, k) => (k === existing && mode ? { ...t, mode } : t)) };
      } else if (newTab) {
        const t: Tab = { id: uid(), kind: "note", path, mode: mode ?? settings.defaultMode };
        tabId = t.id;
        next = { ...p, tabs: [...p.tabs.slice(0, p.active + 1), t, ...p.tabs.slice(p.active + 1)], active: p.active + 1 };
      } else {
        const cur = p.tabs[p.active];
        const t: Tab = { ...cur, kind: "note", path, mode: mode ?? (cur.kind === "note" ? cur.mode : settings.defaultMode) };
        if (cur.path !== path) {
          t.id = uid();
          if (cur.kind === "note" && cur.path) {
            t.back = [...(cur.back ?? []), cur.path];
            t.fwd = [];
          }
        }
        tabId = t.id;
        next = { ...p, tabs: p.tabs.map((x, k) => (k === p.active ? t : x)) };
      }
      if (line != null) pendingJump.current = { tabId, line };
      return ps.map((x, k) => (k === i ? next : x));
    });
  }

  // 오른쪽에 새 창을 만들고 그 창에서 연다 (빠른 전환 ⌘⌥↵)
  const openRight = (path: string) => {
    setPanes((ps) => [...ps.slice(0, activePane + 1), { id: uid(), tabs: [{ id: uid(), kind: "note", path, mode: settings.defaultMode }], active: 0 }, ...ps.slice(activePane + 1)]);
    setActivePane(activePane + 1);
  };

  const openLink = (target: string, newTab: boolean) => {
    const path = resolveLink(target, filesRef.current);
    if (path) openFile(path, newTab);
    else {
      // 없는 노트를 클릭하면 새로 만든다
      const folder = target.includes("/") ? dirname(target) : "";
      createNote(folder, basename(target), "", newTab ? "new" : "current");
    }
  };

  const newTab = (kind: TabKind = "empty") =>
    updatePane(activePane, (p) => ({ ...p, tabs: [...p.tabs, { id: uid(), kind, mode: settings.defaultMode }], active: p.tabs.length }));

  const closeTab = (pi: number, ti: number) =>
    setPanes((ps) => {
      const p = ps[pi];
      if (p.tabs.length === 1) {
        if (ps.length > 1) {
          setActivePane((a) => Math.max(0, a >= pi ? a - 1 : a));
          return ps.filter((_, k) => k !== pi);
        }
        return ps.map((x, k) => (k === pi ? { ...x, tabs: [{ id: uid(), kind: "empty", mode: "edit" }], active: 0 } : x));
      }
      const tabs = p.tabs.filter((_, k) => k !== ti);
      const active = ti < p.active || p.active >= tabs.length ? Math.max(0, p.active - 1) : p.active;
      return ps.map((x, k) => (k === pi ? { ...x, tabs, active } : x));
    });

  const split = () => {
    if (!tab) return;
    const t: Tab = { ...tab, id: uid() };
    setPanes((ps) => [...ps.slice(0, activePane + 1), { id: uid(), tabs: [t], active: 0 }, ...ps.slice(activePane + 1)]);
    setActivePane(activePane + 1);
  };

  const setMode = (mode: "edit" | "read") => updatePane(activePane, (p) => ({ ...p, tabs: p.tabs.map((t, k) => (k === p.active ? { ...t, mode } : t)) }));
  const toggleMode = () => tab?.kind === "note" && setMode(tab.mode === "edit" ? "read" : "edit");

  // 탭별 앞으로·뒤로 이동
  const navigate = (pi: number, dir: "back" | "fwd") =>
    updatePane(pi, (p) => ({
      ...p,
      tabs: p.tabs.map((t, k) => {
        if (k !== p.active || !t.path) return t;
        const from = dir === "back" ? t.back ?? [] : t.fwd ?? [];
        const target = from[from.length - 1];
        if (!target) return t;
        const rest = from.slice(0, -1);
        return dir === "back"
          ? { ...t, id: uid(), path: target, back: rest, fwd: [...(t.fwd ?? []), t.path] }
          : { ...t, id: uid(), path: target, fwd: rest, back: [...(t.back ?? []), t.path] };
      }),
    }));

  const openGraph = () => {
    const gi = pane?.tabs.findIndex((t) => t.kind === "graph") ?? -1;
    if (gi >= 0) updatePane(activePane, (p) => ({ ...p, active: gi }));
    else newTab("graph");
  };

  const openSearch = (q?: string) => {
    setLeftOpen(true);
    setLeftView("search");
    if (q != null) setQuery(q);
  };

  const jumpTo = (index: number, line: number) => {
    if (!tab) return;
    if (tab.mode === "read") readers.current.get(tab.id)?.scrollToHeading(index);
    else editors.current.get(tab.id)?.scrollToLine(line);
  };

  // ---------- 명령 ----------
  const commands: Command[] = [
    { id: "switcher", name: "빠른 전환: 노트 열기", key: "mod+o", run: () => setModal({ type: "switcher" }) },
    { id: "palette", name: "커맨드 팔레트 열기", key: "mod+p", run: () => setModal({ type: "palette" }) },
    { id: "new-note", name: "새 노트 만들기", key: NATIVE ? "mod+n" : "mod+alt+n", run: () => createNote(activeFile ? dirname(activeFile.path) : "") },
    { id: "new-note-tab", name: "새 탭에서 새 노트 만들기", run: () => createNote(activeFile ? dirname(activeFile.path) : "", "제목 없음", "", "new") },
    { id: "daily", name: "오늘의 일일 노트 열기", key: "mod+alt+d", run: openDaily },
    { id: "toggle-mode", name: "편집·읽기 모드 전환", key: "mod+e", run: toggleMode },
    { id: "toggle-lp", name: "Live Preview·소스 모드 전환", key: "mod+alt+e", run: () => setSettings({ ...settings, livePreview: !settings.livePreview }) },
    { id: "new-tab", name: "새 탭 열기", key: NATIVE ? "mod+t" : "mod+alt+t", run: () => newTab() },
    { id: "close-tab", name: "현재 탭 닫기", key: NATIVE ? "mod+w" : "mod+alt+w", run: () => pane && closeTab(activePane, pane.active) },
    { id: "split", name: "오른쪽으로 분할", key: "mod+\\", run: split },
    { id: "next-tab", name: "다음 탭으로 이동", run: () => updatePane(activePane, (p) => ({ ...p, active: (p.active + 1) % p.tabs.length })) },
    { id: "back", name: "뒤로 가기", key: "mod+alt+arrowleft", run: () => navigate(activePane, "back") },
    { id: "forward", name: "앞으로 가기", key: "mod+alt+arrowright", run: () => navigate(activePane, "fwd") },
    { id: "graph", name: "그래프 뷰 열기", key: "mod+g", run: openGraph },
    { id: "search", name: "전체 검색", key: "mod+shift+f", run: () => openSearch() },
    { id: "files", name: "파일 탐색기 보기", run: () => (setLeftOpen(true), setLeftView("files")) },
    { id: "tags", name: "태그 보기", run: () => (setLeftOpen(true), setLeftView("tags")) },
    { id: "backlinks", name: "백링크 보기", run: () => (setRightOpen(true), setRightView("backlinks")) },
    { id: "outline", name: "개요 보기", run: () => (setRightOpen(true), setRightView("outline")) },
    { id: "local-graph", name: "로컬 그래프 보기", run: () => (setRightOpen(true), setRightView("graph")) },
    { id: "left", name: "왼쪽 사이드바 접기·펴기", key: "mod+alt+l", run: () => setLeftOpen((o) => !o) },
    { id: "right", name: "오른쪽 사이드바 접기·펴기", key: "mod+alt+r", run: () => setRightOpen((o) => !o) },
    { id: "rename", name: "현재 노트 이름 바꾸기", run: () => activeFile && setModal({ type: "rename", path: activeFile.path, folder: false }) },
    { id: "delete", name: "현재 노트 삭제", run: () => activeFile && setModal({ type: "delete", path: activeFile.path, folder: false }) },
    { id: "theme", name: "밝은·어두운 테마 전환", run: () => setSettings({ ...settings, theme: settings.theme === "dark" ? "light" : "dark" }) },
    { id: "settings", name: "설정 열기", key: "mod+,", run: () => setModal({ type: "settings" }) },
    { id: "vault", name: "다른 볼트 열기", run: () => setBackend(null) },
    ...(backend?.kind === "memory"
      ? [{ id: "reset", name: "샘플 볼트 초기화", run: () => { try { localStorage.removeItem(SAMPLE_KEY); } catch { /* 무시 */ } openVault(createSampleVault()); } }]
      : []),
  ];
  const cmdRef = useRef(commands);
  cmdRef.current = commands;

  // 단축키: 캡처 단계에서 받아서 편집기보다 먼저 처리
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!backend) return;
      const mod = isMac ? e.metaKey : e.ctrlKey;
      const named: Record<string, string> = { Backslash: "\\", Comma: ",", Period: ".", Slash: "/" };
      const key = e.code.startsWith("Key") ? e.code.slice(3).toLowerCase() : e.code.startsWith("Digit") ? e.code.slice(5) : named[e.code] ?? e.key.toLowerCase();
      const combo = [mod && "mod", isMac && e.ctrlKey && "ctrl", e.altKey && "alt", e.shiftKey && "shift", key].filter(Boolean).join("+");
      const cmd = cmdRef.current.find((c) => c.key === combo);
      if (cmd) {
        e.preventDefault();
        e.stopPropagation();
        setModal(null);
        cmd.run();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [backend]);

  // 편집기가 준비되면 대기 중인 줄 이동 실행
  const editorRef = (tabId: string) => (h: EditorHandle | null) => {
    if (!h) return void editors.current.delete(tabId);
    editors.current.set(tabId, h);
    const j = pendingJump.current;
    if (j && j.tabId === tabId) {
      pendingJump.current = null;
      setTimeout(() => h.scrollToLine(j.line), 30);
    }
  };
  const readerRef = (tabId: string) => (h: ReadingHandle | null) => (h ? readers.current.set(tabId, h) : readers.current.delete(tabId));

  const handleRefs = useRef(new Map<string, { e: (h: EditorHandle | null) => void; r: (h: ReadingHandle | null) => void }>());
  const refsFor = (tabId: string) => {
    if (!handleRefs.current.has(tabId)) handleRefs.current.set(tabId, { e: editorRef(tabId), r: readerRef(tabId) });
    return handleRefs.current.get(tabId)!;
  };

  // 같은 탭에서 줄 이동만 요청된 경우(이미 열린 노트)
  useEffect(() => {
    const j = pendingJump.current;
    if (!j) return;
    const h = editors.current.get(j.tabId);
    if (h) {
      pendingJump.current = null;
      setTimeout(() => h.scrollToLine(j.line), 30);
    }
  });

  const backlinkCount = useMemo(
    () => (activeFile ? files.filter((f) => f.path !== activeFile.path && parseWikiLinks(f.content).some((l) => resolveLink(l.target, files) === activeFile.path)).length : 0),
    [files, activeFile],
  );
  const stats = activeFile ? countWords(activeFile.content) : null;

  // ---------- 시작 화면 ----------
  if (!backend) return <StartScreen onOpen={openVault} notify={notify} toast={toast} />;

  const leftViews: [LeftView, React.ReactNode, string][] = [
    ["files", <FolderClosed size={18} />, "파일 탐색기"],
    ["search", <Search size={18} />, "검색"],
    ["tags", <Tags size={18} />, "태그"],
  ];
  const rightViews: [RightView, React.ReactNode, string][] = [
    ["backlinks", <Link2 size={18} />, "백링크"],
    ["outline", <ListTree size={18} />, "개요"],
    ["graph", <Waypoints size={18} />, "로컬 그래프"],
  ];

  return (
    <div className={`app${settings.readableWidth ? " readable" : ""}${leftOpen ? "" : " left-closed"}${rightOpen ? "" : " right-closed"}`}>
      {/* 왼쪽 도크: 머리줄(사이드바 탭 + 접기) 아래에 리본과 사이드바 */}
      <div className="rn-dock rn-dock-left">
        <div className="rn-dock-head">
          <span className="rn-traffic-space" />
          {leftOpen && leftViews.map(([id, icon, title]) => (
            <button key={id} title={title} className={leftView === id ? "rn-current" : ""} onClick={() => setLeftView(id)}>{icon}</button>
          ))}
          <span className="rn-grow" />
          <button className="rn-dock-toggle" title="왼쪽 사이드바 접기·펴기" onClick={() => setLeftOpen((o) => !o)}><PanelLeft size={18} /></button>
        </div>
        <div className="rn-dock-body">
          <div className="ribbon">
            <div className="ribbon-top">
              <button title={`빠른 전환 (${keyLabel("mod+o")})`} onClick={() => setModal({ type: "switcher" })}><FileSearch size={18} /></button>
              <button title={`그래프 뷰 (${keyLabel("mod+g")})`} onClick={openGraph}><Waypoints size={18} /></button>
              <button title="오늘의 일일 노트" onClick={openDaily}><CalendarDays size={18} /></button>
              <button title={`커맨드 팔레트 (${keyLabel("mod+p")})`} onClick={() => setModal({ type: "palette" })}><SquareTerminal size={18} /></button>
            </div>
            {!leftOpen && (
              <div className="ribbon-bottom">
                <button title="다른 볼트 열기" onClick={() => setBackend(null)}><FolderOpen size={18} /></button>
                <button title={`설정 (${keyLabel("mod+,")})`} onClick={() => setModal({ type: "settings" })}><SettingsIcon size={18} /></button>
              </div>
            )}
          </div>

      {/* 왼쪽 사이드바 */}
      {leftOpen && (
        <aside className="sidebar left">
          <div className="sidebar-content">
            {leftView === "files" && (
              <FileExplorer
                files={files}
                folders={folders}
                activePath={activeFile?.path ?? null}
                onOpen={(p, nt) => openFile(p, nt)}
                onNewNote={(f) => createNote(f)}
                onNewFolder={(parent) => setModal({ type: "newfolder", parent })}
                onRename={(path, folder) => setModal({ type: "rename", path, folder })}
                onDelete={(path, folder) => setModal({ type: "delete", path, folder })}
                onMove={(from, toFolder) => {
                  const isFolder = folders.includes(from);
                  const name = from.split("/").pop()!;
                  if (isFolder && (toFolder === from || toFolder.startsWith(from + "/"))) return;
                  movePath(from, toFolder ? `${toFolder}/${name}` : name, isFolder);
                }}
              />
            )}
            {leftView === "search" && <SearchPanel files={files} query={query} setQuery={setQuery} onOpen={(p, line) => openFile(p, false, line != null ? "edit" : undefined, line)} />}
            {leftView === "tags" && <TagsPanel files={files} onTag={(t) => openSearch(`tag:#${t}`)} />}
          </div>
          <div className="vault-switcher">
            <div className="vault-switcher-name" onClick={() => setBackend(null)} title="다른 볼트 열기">
              <ChevronsUpDown size={16} /> <span>{backend.name}</span>
            </div>
            <button title={`설정 (${keyLabel("mod+,")})`} onClick={() => setModal({ type: "settings" })}><SettingsIcon size={18} /></button>
          </div>
        </aside>
      )}
        </div>
      </div>

      {/* 작업 영역: 분할 창 */}
      <main className="rn-main">
        {panes.map((p, pi) => {
          const t = p.tabs[p.active];
          const file = t.kind === "note" ? files.find((f) => f.path === t.path) : undefined;
          return (
            <section key={p.id} className={`pane${pi === activePane ? " rn-current" : ""}`} onMouseDown={() => setActivePane(pi)}>
              <div className="tab-header">
                <div className="tabs">
                  {p.tabs.map((x, ti) => (
                    <div
                      key={x.id}
                      className={`tab${ti === p.active ? " rn-current" : ""}`}
                      onClick={() => updatePane(pi, (q) => ({ ...q, active: ti }))}
                      onAuxClick={(e) => e.button === 1 && closeTab(pi, ti)}
                    >
                      {x.kind === "graph" && <Waypoints size={15} className="tab-icon" />}
                      <span className="tab-title">{x.kind === "graph" ? "그래프 뷰" : x.kind === "empty" ? "새 탭" : basename(x.path!)}</span>
                      <button className="tab-close" onClick={(e) => { e.stopPropagation(); closeTab(pi, ti); }}><X size={13} /></button>
                    </div>
                  ))}
                  <button className="tab-new" title="새 탭" onClick={() => { setActivePane(pi); updatePane(pi, (q) => ({ ...q, tabs: [...q.tabs, { id: uid(), kind: "empty", mode: settings.defaultMode }], active: q.tabs.length })); }}><Plus size={15} /></button>
                </div>
                <div className="tab-actions">
                  {pi === panes.length - 1 && !rightOpen && <button title="오른쪽 사이드바 펴기" onClick={() => setRightOpen(true)}><PanelRight size={18} /></button>}
                </div>
              </div>

              {t.kind === "note" && file && (
                <div className="rn-view-top">
                  <div className="view-nav">
                    <button title="뒤로" disabled={!t.back?.length} onClick={() => navigate(pi, "back")}><ArrowLeft size={16} /></button>
                    <button title="앞으로" disabled={!t.fwd?.length} onClick={() => navigate(pi, "fwd")}><ArrowRight size={16} /></button>
                  </div>
                  <div className="breadcrumb">
                    {dirname(file.path) && <><span className="crumb-folder">{dirname(file.path).split("/").join(" / ")}</span><span className="crumb-sep">&nbsp;/&nbsp;</span></>}
                    <span>{basename(file.path)}</span>
                  </div>
                  <button className="rn-view-btn" title={`${t.mode === "edit" ? "읽기 보기로" : "편집 보기로"} 전환 (${keyLabel("mod+e")})`} onClick={() => updatePane(pi, (q) => ({ ...q, tabs: q.tabs.map((y, k) => (k === q.active ? { ...y, mode: y.mode === "edit" ? "read" : "edit" } : y)) }))}>
                    {t.mode === "edit" ? <BookOpen size={18} /> : <Pencil size={18} />}
                  </button>
                  <button className="rn-view-btn" title="다른 옵션" onClick={(e) => { e.stopPropagation(); setActivePane(pi); setMoreMenu(moreMenu === pi ? null : pi); }}>
                    <Ellipsis size={18} />
                  </button>
                  {moreMenu === pi && (
                    <div className="rn-popover rn-more-menu" onMouseDown={(e) => e.stopPropagation()}>
                      <div className="rn-popover-item" onClick={() => { setMoreMenu(null); split(); }}><Columns2 size={15} /> 오른쪽으로 분할</div>
                      <div className="rn-popover-item" onClick={() => { setMoreMenu(null); setModal({ type: "rename", path: file.path, folder: false }); }}><Pencil size={15} /> 이름 바꾸기</div>
                      <div className="rn-popover-item rn-danger" onClick={() => { setMoreMenu(null); setModal({ type: "delete", path: file.path, folder: false }); }}><Trash2 size={15} /> 삭제</div>
                    </div>
                  )}
                </div>
              )}

              {t.kind === "graph" && (
                <div className="rn-view-top">
                  <div className="view-nav">
                    <button title="뒤로" disabled={!t.back?.length} onClick={() => navigate(pi, "back")}><ArrowLeft size={16} /></button>
                    <button title="앞으로" disabled={!t.fwd?.length} onClick={() => navigate(pi, "fwd")}><ArrowRight size={16} /></button>
                  </div>
                  <div className="breadcrumb"><span>그래프 뷰</span></div>
                  <button className="rn-view-btn" title="다른 옵션" onClick={(e) => { e.stopPropagation(); setActivePane(pi); setMoreMenu(moreMenu === pi ? null : pi); }}>
                    <Ellipsis size={18} />
                  </button>
                  {moreMenu === pi && (
                    <div className="rn-popover rn-more-menu" onMouseDown={(e) => e.stopPropagation()}>
                      <div className="rn-popover-item" onClick={() => { setMoreMenu(null); split(); }}><Columns2 size={15} /> 오른쪽으로 분할</div>
                    </div>
                  )}
                </div>
              )}
              <div className="rn-view-body">
                {t.kind === "note" && file && (
                  <div className="note-scroll">
                    <div className="note-sizer">
                      {settings.inlineTitle && (
                        <InlineTitle key={file.path} name={basename(file.path)} onRename={(n) => movePath(file.path, (dirname(file.path) ? dirname(file.path) + "/" : "") + n + ".md", false)} />
                      )}
                      {t.mode === "edit" ? (
                        <Editor
                          docKey={t.id}
                          value={file.content}
                          livePreview={settings.livePreview}
                          onChange={(v) => writeFile(file.path, v)}
                          onOpenLink={openLink}
                          handleRef={refsFor(t.id).e}
                        />
                      ) : (
                        <ReadingView
                          content={file.content}
                          exists={exists}
                          onOpenLink={openLink}
                          onTag={(tag) => openSearch(`tag:#${tag}`)}
                          onToggleTask={(n) => writeFile(file.path, toggleTask(file.content, n), true)}
                          handleRef={refsFor(t.id).r}
                        />
                      )}
                    </div>
                  </div>
                )}
                {t.kind === "note" && !file && <div className="rn-blank">파일을 찾을 수 없습니다</div>}
                {t.kind === "graph" && <GraphView files={files} activePath={activeFile?.path ?? null} onOpen={(path) => openFile(path, true)} />}
                {t.kind === "empty" && (
                  <div className="rn-blank">
                    <div className="rn-blank-title">새 탭</div>
                    <div className="rn-blank-action" onClick={() => createNote("")}><FilePlus size={15} /> 새 노트 만들기 <kbd>{keyLabel(NATIVE ? "mod+n" : "mod+alt+n")}</kbd></div>
                    <div className="rn-blank-action" onClick={() => setModal({ type: "switcher" })}><FileSearch size={15} /> 파일로 이동 <kbd>{keyLabel("mod+o")}</kbd></div>
                    <div className="rn-blank-action" onClick={openGraph}><Waypoints size={15} /> 그래프 뷰 열기 <kbd>{keyLabel("mod+g")}</kbd></div>
                    <div className="rn-blank-action" onClick={() => closeTab(pi, p.active)}><X size={15} /> 닫기</div>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </main>

      {/* 오른쪽 사이드바 */}
      {rightOpen && (
        <div className="rn-dock rn-dock-right">
        <div className="rn-dock-head">
          {rightViews.map(([id, icon, title]) => (
            <button key={id} title={title} className={rightView === id ? "rn-current" : ""} onClick={() => setRightView(id)}>{icon}</button>
          ))}
          <span className="rn-grow" />
          <button className="rn-dock-toggle" title="오른쪽 사이드바 접기" onClick={() => setRightOpen(false)}><PanelRight size={18} /></button>
        </div>
        <aside className="sidebar right">
          <div className="sidebar-content">
            {rightView === "backlinks" && <BacklinksPanel files={files} path={activeFile?.path ?? null} onOpen={(p, line) => openFile(p, false, line != null ? "edit" : undefined, line)} />}
            {rightView === "outline" && <OutlinePanel content={activeFile?.content ?? null} onJump={jumpTo} />}
            {rightView === "graph" && (activeFile ? <div className="local-graph"><GraphView files={files} activePath={activeFile.path} localOnly onOpen={(path) => openFile(path, false)} /></div> : <div className="panel empty">열린 노트가 없습니다</div>)}
          </div>
        </aside>
        </div>
      )}

      {/* 상태 표시줄 */}
      <footer className="rn-statusbar">
        {activeFile && stats && (
          <>
            <span className="status-item clickable" onClick={() => (setRightOpen(true), setRightView("backlinks"))}>{backlinkCount}개 백링크</span>
            <span
              className="status-item clickable status-icon"
              title={tab?.mode === "edit" ? (settings.livePreview ? "현재 보기: Live Preview" : "현재 보기: 소스 모드") : "현재 보기: 읽기"}
              onClick={toggleMode}
            >
              {tab?.mode === "edit" ? <Pencil size={15} /> : <BookOpen size={15} />}
            </span>
            <span className="status-item">{stats.words.toLocaleString()}개 단어</span>
            <span className="status-item">{stats.chars.toLocaleString()}개 문자</span>
          </>
        )}
      </footer>

      {/* 모달 */}
      {modal?.type === "switcher" && (
        <PickerModal
          placeholder="이동하거나 생성하려는 파일 이름 입력…"
          items={[...files].sort((a, b) => b.mtime - a.mtime).map((f) => ({ id: f.path, label: f.path.replace(/\.md$/, "") }))}
          initialItems={recent.filter((p) => p !== activeFile?.path && files.some((f) => f.path === p)).map((p) => ({ id: p, label: p.replace(/\.md$/, "") }))}
          initialEmptyText="최근 파일을 찾지 못했습니다. 검색어를 입력하세요…"
          emptyAction={(q) => ({ id: "__create__", label: q, note: "↵ 새 노트 만들기" })}
          instructions={[[`${MOD}↵`, "새 탭에서 열기"], [`${MOD}${isMac ? "⌥" : "Alt+"}↵`, "오른쪽에 열기"], [isMac ? "⇧↵" : "Shift+↵", "생성하기"]]}
          onPick={(it, q, k) => {
            setModal(null);
            if (it.id === "__create__") createNote("", q.trim(), "", k.mod ? "new" : "current");
            else if (k.mod && k.alt) openRight(it.id);
            else openFile(it.id, k.mod);
          }}
          onShiftEnter={(q) => {
            setModal(null);
            createNote("", q.trim());
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === "palette" && (
        <PickerModal
          placeholder="명령 선택…"
          items={commands
            .filter((c) => c.id !== "palette")
            .sort((a, b) => a.name.localeCompare(b.name, "ko"))
            .map<PickerItem>((c) => ({ id: c.id, label: c.name, hotkey: c.key ? keyLabel(c.key, true) : undefined }))}
          instructions={[["↑↓", "이동"], ["↵", "실행"], ["esc", "닫기"]]}
          onPick={(it) => {
            setModal(null);
            commands.find((c) => c.id === it.id)?.run();
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === "settings" && (
        <SettingsModal
          settings={settings}
          onChange={setSettings}
          hotkeys={commands.map((c) => ({ name: c.name, hotkey: keyLabel(c.key) }))}
          vaultName={backend.name}
          fileCount={files.length}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === "rename" && (
        <InputModal
          title={modal.folder ? "폴더 이름 바꾸기" : "노트 이름 바꾸기"}
          initial={modal.folder ? modal.path.split("/").pop()! : basename(modal.path)}
          onClose={() => setModal(null)}
          onSubmit={(v) => {
            const dir = dirname(modal.path);
            movePath(modal.path, (dir ? dir + "/" : "") + v + (modal.folder ? "" : ".md"), modal.folder);
            setModal(null);
          }}
        />
      )}
      {modal?.type === "newfolder" && (
        <InputModal
          title="새 폴더"
          initial="새 폴더"
          onClose={() => setModal(null)}
          onSubmit={async (v) => {
            const path = modal.parent ? `${modal.parent}/${v}` : v;
            setModal(null);
            if (folders.includes(path)) return notify("같은 이름의 폴더가 있습니다");
            setFolders((fs) => [...new Set([...fs, ...parentFolders(path + "/x")])]);
            await backend.mkdir(path);
          }}
        />
      )}
      {modal?.type === "delete" && (
        <ConfirmModal
          title={modal.folder ? "폴더 삭제" : "노트 삭제"}
          message={`"${modal.folder ? modal.path : basename(modal.path)}"${modal.folder ? " 폴더와 안의 노트를 모두" : "을(를)"} 삭제할까요?`}
          onClose={() => setModal(null)}
          onOk={() => {
            deletePath(modal.path, modal.folder);
            setModal(null);
          }}
        />
      )}
      {toast && <div className="rn-toast">{toast}</div>}
    </div>
  );
}

// 본문 위 제목: 고치고 Enter 또는 포커스를 잃으면 파일 이름이 바뀐다
function InlineTitle({ name, onRename }: { name: string; onRename(n: string): void }) {
  const [v, setV] = useState(name);
  const commit = () => {
    const n = v.trim().replace(/[\\/:]/g, "");
    if (n && n !== name) onRename(n);
    else setV(name);
  };
  return (
    <input
      className="rn-note-title"
      value={v}
      spellCheck={false}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") { setV(name); (e.target as HTMLInputElement).blur(); }
      }}
    />
  );
}

// ---------- 시작 화면 (볼트 선택) ----------
function StartScreen({ onOpen, notify, toast }: { onOpen(b: VaultBackend): void; notify(m: string): void; toast: string | null }) {
  const pickFolder = async () => {
    try {
      if (electronSupported) {
        const b = await createElectronVault();
        if (b) onOpen(b);
      } else onOpen(await createBrowserVault());
    } catch (e) {
      if ((e as Error).name !== "AbortError") notify("폴더를 열 수 없습니다: " + (e as Error).message);
    }
  };
  return (
    <div className="start-screen">
      <div className="start-card">
        <div className="start-brand">
          <div className="start-logo"><NotebookPen size={36} /></div>
          <div className="start-name">REA Notes</div>
          <div className="start-version">버전 0.1.0 · 로컬 마크다운 노트</div>
        </div>
        <div className="start-actions">
          <div className="start-action">
            <div>
              <div className="start-action-title">샘플 볼트 열기</div>
              <div className="start-action-desc">미리 준비한 노트 9개로 바로 시작합니다. 변경 사항은 이 브라우저에 저장됩니다.</div>
            </div>
            <button className="rn-btn-primary" onClick={() => onOpen(createSampleVault())}>열기</button>
          </div>
          <div className="start-action">
            <div>
              <div className="start-action-title">폴더를 볼트로 열기</div>
              <div className="start-action-desc">
                {electronSupported || browserFolderSupported
                  ? "컴퓨터의 폴더를 골라 그 안의 .md 파일을 직접 읽고 씁니다."
                  : "이 브라우저는 폴더 열기를 지원하지 않습니다. Chrome 또는 Edge에서 열어 주세요."}
              </div>
            </div>
            <button disabled={!electronSupported && !browserFolderSupported} onClick={pickFolder}>폴더 열기</button>
          </div>
        </div>
      </div>
      {toast && <div className="rn-toast">{toast}</div>}
    </div>
  );
}
