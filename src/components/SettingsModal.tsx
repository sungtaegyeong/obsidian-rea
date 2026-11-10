import { createContext, useContext, useState } from "react";
import { X, Search, CircleUser, Palette, PenLine, Command } from "lucide-react";

export interface Settings {
  theme: "dark" | "light";
  fontSize: number;
  readableWidth: boolean;
  livePreview: boolean;
  defaultMode: "edit" | "read";
  inlineTitle: boolean;
  accent: string;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  fontSize: 16,
  readableWidth: true,
  livePreview: true,
  defaultMode: "edit",
  inlineTitle: true,
  accent: "#8a5cf5",
};

const KEY = "rea-notes:settings";
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}
export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 저장 불가 환경은 무시 */
  }
}

const ACCENTS = ["#8a5cf5", "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#ec4899"];

interface Props {
  settings: Settings;
  onChange(s: Settings): void;
  hotkeys: { name: string; hotkey?: string }[];
  vaultName: string;
  fileCount: number;
  onClose(): void;
}

type TabId = "about" | "appearance" | "editor" | "hotkeys";
const TABS: [TabId, string, React.ReactNode][] = [
  ["about", "일반", <CircleUser size={18} />],
  ["appearance", "외형", <Palette size={18} />],
  ["editor", "편집기", <PenLine size={18} />],
  ["hotkeys", "단축키", <Command size={18} />],
];

// 설정 검색어: 이름이나 설명에 검색어가 없는 항목은 숨긴다
const QueryCtx = createContext("");

function Row({ name, desc, children }: { name: string; desc?: string; children: React.ReactNode }) {
  const q = useContext(QueryCtx).trim().toLowerCase();
  if (q && !(name + " " + (desc ?? "")).toLowerCase().includes(q)) return null;
  return (
    <div className="rn-opt">
      <div className="rn-opt-info">
        <div className="rn-opt-name">{name}</div>
        {desc && <div className="rn-opt-desc">{desc}</div>}
      </div>
      <div className="rn-opt-ctrl">{children}</div>
    </div>
  );
}

function Toggle({ on, set }: { on: boolean; set(v: boolean): void }) {
  return <div className={`rn-switch${on ? " rn-on" : ""}`} onClick={() => set(!on)} role="switch" aria-checked={on} />;
}

export default function SettingsModal({ settings, onChange, hotkeys, vaultName, fileCount, onClose }: Props) {
  const [tab, setTab] = useState<TabId>("about");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...settings, [k]: v });

  const sections: Record<TabId, React.ReactNode> = {
    about: (
      <div className="rn-opt-group">
        <Row name="REA Notes" desc="REA 분석 결과를 바탕으로 처음부터 다시 작성한 마크다운 노트 앱 (학습용)">
          <span className="muted">v0.1.0</span>
        </Row>
        <Row name="현재 볼트" desc={`노트 ${fileCount}개`}>
          <span className="muted">{vaultName}</span>
        </Row>
      </div>
    ),
    appearance: (
      <div className="rn-opt-group">
        <Row name="테마" desc="어두운 테마와 밝은 테마 중에서 고릅니다.">
          <select value={settings.theme} onChange={(e) => set("theme", e.target.value as Settings["theme"])}>
            <option value="dark">어둡게</option>
            <option value="light">밝게</option>
          </select>
        </Row>
        <Row name="강조 색" desc="링크, 선택한 항목, 그래프의 현재 노트에 쓰입니다.">
          <div className="accent-swatches">
            {ACCENTS.map((c) => (
              <button key={c} className={`swatch${settings.accent === c ? " rn-current" : ""}`} style={{ background: c }} onClick={() => set("accent", c)} aria-label={c} />
            ))}
          </div>
        </Row>
        <Row name="글꼴 크기" desc={`편집기와 읽기 모드의 본문 글꼴 크기: ${settings.fontSize}px`}>
          <input type="range" min={12} max={24} value={settings.fontSize} onChange={(e) => set("fontSize", +e.target.value)} />
        </Row>
      </div>
    ),
    editor: (
      <div className="rn-opt-group">
        <Row name="새 탭의 기본 보기" desc="노트를 처음 열 때 편집 모드로 열지 읽기 모드로 열지 정합니다.">
          <select value={settings.defaultMode} onChange={(e) => set("defaultMode", e.target.value as Settings["defaultMode"])}>
            <option value="edit">편집 보기</option>
            <option value="read">읽기 보기</option>
          </select>
        </Row>
        <Row name="Live Preview" desc="편집 중에도 커서가 없는 줄의 마크다운 기호를 숨겨서 결과에 가깝게 보여줍니다. 끄면 소스 모드가 됩니다.">
          <Toggle on={settings.livePreview} set={(v) => set("livePreview", v)} />
        </Row>
        <Row name="읽기 좋은 줄 너비" desc="본문 너비를 제한해서 넓은 화면에서도 읽기 편하게 합니다.">
          <Toggle on={settings.readableWidth} set={(v) => set("readableWidth", v)} />
        </Row>
        <Row name="노트 제목 표시" desc="본문 위에 파일 이름을 제목으로 보여주고, 바로 고칠 수 있게 합니다.">
          <Toggle on={settings.inlineTitle} set={(v) => set("inlineTitle", v)} />
        </Row>
      </div>
    ),
    hotkeys: (
      <>
        {!query && <input className="search-input rn-opt-filter" placeholder="명령 이름으로 필터…" value={filter} onChange={(e) => setFilter(e.target.value)} />}
        <div className="rn-opt-group">
          {hotkeys
            .filter((h) => h.name.toLowerCase().includes(filter.toLowerCase()))
            .map((h) => (
              <Row key={h.name} name={h.name}>
                {h.hotkey ? <span className="rn-hotkey">{h.hotkey}</span> : <span className="muted">없음</span>}
              </Row>
            ))}
        </div>
      </>
    ),
  };

  return (
    <div className="modal-backdrop settings-backdrop" onMouseDown={onClose}>
      <div className="rn-dialog settings-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-nav">
          <label className="settings-search">
            <Search size={16} />
            <input autoFocus placeholder="설정 검색…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="settings-nav-title">옵션</div>
          {TABS.map(([id, label, icon]) => (
            <div key={id} className={`settings-nav-item${!query && tab === id ? " rn-current" : ""}`} onClick={() => { setQuery(""); setTab(id); }}>
              {icon} {label}
            </div>
          ))}
        </div>
        <div className="settings-content">
          <button className="modal-close" onClick={onClose} aria-label="닫기"><X size={18} /></button>
          <QueryCtx.Provider value={query}>
            {query
              ? TABS.map(([id, label]) => (
                  <section key={id}>
                    <h3 className="settings-group-title">{label}</h3>
                    {sections[id]}
                  </section>
                ))
              : sections[tab]}
          </QueryCtx.Provider>
        </div>
      </div>
    </div>
  );
}
