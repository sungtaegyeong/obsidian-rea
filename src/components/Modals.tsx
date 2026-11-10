import { useEffect, useMemo, useRef, useState } from "react";
import { CircleX } from "lucide-react";

// 퍼지 매칭: 질의 글자가 순서대로 모두 등장하면 일치, 연속·앞쪽 일치일수록 높은 점수
export function fuzzy(query: string, text: string): { score: number; idx: number[] } | null {
  if (!query) return { score: 0, idx: [] };
  const q = query.toLowerCase(), t = text.toLowerCase();
  const idx: number[] = [];
  let score = 0, last = -2, from = 0;
  for (const ch of q) {
    if (ch === " ") continue;
    const i = t.indexOf(ch, from);
    if (i < 0) return null;
    score += i === last + 1 ? 5 : 1;
    if (i === 0 || /[\s/_-]/.test(t[i - 1])) score += 3;
    idx.push(i);
    last = i;
    from = i + 1;
  }
  return { score: score - t.length * 0.01, idx };
}

const Highlight = ({ text, idx }: { text: string; idx: number[] }) => (
  <>
    {[...text].map((c, i) => (idx.includes(i) ? <b key={i}>{c}</b> : <span key={i}>{c}</span>))}
  </>
);

export interface PickerItem {
  id: string;
  label: string;
  note?: string;
  hotkey?: string;
}

export interface PickKeys {
  mod: boolean; // ⌘/Ctrl
  alt: boolean; // ⌥/Alt
  shift: boolean;
}

interface PickerProps {
  placeholder: string;
  items: PickerItem[];
  /** 검색어가 비었을 때 보여줄 목록 (없으면 items 전체) */
  initialItems?: PickerItem[];
  /** initialItems가 비었을 때 안내 문구 */
  initialEmptyText?: string;
  emptyAction?: (query: string) => PickerItem | null;
  instructions: [string, string][];
  onPick(item: PickerItem, query: string, keys: PickKeys): void;
  /** 선택 항목 없이 Shift+Enter (예: 새 노트 만들기) */
  onShiftEnter?(query: string): void;
  onClose(): void;
}

const keysOf = (e: { metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }): PickKeys => ({
  mod: e.metaKey || e.ctrlKey,
  alt: e.altKey,
  shift: e.shiftKey,
});

export function PickerModal({ placeholder, items, initialItems, initialEmptyText, emptyAction, instructions, onPick, onShiftEnter, onClose }: PickerProps) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const list = useMemo(() => {
    const source = !query && initialItems ? initialItems : items;
    const scored = source
      .map((it) => ({ it, m: fuzzy(query, it.label) }))
      .filter((x) => x.m)
      .sort((a, b) => (query ? b.m!.score - a.m!.score : 0));
    const out = scored.map((x) => ({ ...x.it, idx: x.m!.idx }));
    // 일치하는 항목이 하나도 없을 때만 "새로 만들기" 항목을 보여준다
    if (query && emptyAction && !out.length) {
      const extra = emptyAction(query);
      if (extra) out.push({ ...extra, idx: [] });
    }
    return out.slice(0, 50);
  }, [items, initialItems, query, emptyAction]);

  useEffect(() => setSel(0), [query]);
  useEffect(() => {
    listRef.current?.children[sel]?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="rn-palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="rn-palette-input-row">
          <input
            ref={inputRef}
            autoFocus
            className="rn-palette-input"
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, list.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              else if (e.key === "Enter" && e.shiftKey && onShiftEnter && query.trim()) { e.preventDefault(); onShiftEnter(query); }
              else if (e.key === "Enter" && list[sel]) { e.preventDefault(); onPick(list[sel], query, keysOf(e)); }
              else if (e.key === "Escape") onClose();
            }}
          />
          {query && (
            <button className="rn-palette-clear" title="지우기" onClick={() => { setQuery(""); inputRef.current?.focus(); }}>
              <CircleX size={18} />
            </button>
          )}
        </div>
        <div className="rn-palette-list" ref={listRef}>
          {list.map((it, i) => (
            <div key={it.id} className={`rn-pick${i === sel ? " rn-picked" : ""}`} onMouseEnter={() => setSel(i)} onClick={(e) => onPick(it, query, keysOf(e))}>
              <div className="rn-pick-body">
                <div className="rn-pick-title"><Highlight text={it.label} idx={it.idx} /></div>
                {it.note && <div className="rn-pick-note">{it.note}</div>}
              </div>
              {it.hotkey && <span className="rn-hotkey">{it.hotkey}</span>}
            </div>
          ))}
          {!list.length && <div className="rn-pick-empty">{!query && initialEmptyText ? initialEmptyText : "일치하는 항목이 없습니다"}</div>}
        </div>
        <div className="rn-palette-hints">
          {instructions.map(([k, v]) => (
            <span key={k}><b>{k}</b> {v}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- 텍스트 입력 (이름 바꾸기 등) ----------
export function InputModal({ title, initial, onSubmit, onClose }: { title: string; initial: string; onSubmit(v: string): void; onClose(): void }) {
  const [v, setV] = useState(initial);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="rn-dialog small" onMouseDown={(e) => e.stopPropagation()}>
        <div className="rn-dialog-title">{title}</div>
        <input
          autoFocus
          className="text-input"
          value={v}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && v.trim()) onSubmit(v.trim());
            if (e.key === "Escape") onClose();
          }}
        />
        <div className="modal-buttons">
          <button onClick={onClose}>취소</button>
          <button className="rn-btn-primary" disabled={!v.trim()} onClick={() => onSubmit(v.trim())}>확인</button>
        </div>
      </div>
    </div>
  );
}

export function ConfirmModal({ title, message, onOk, onClose }: { title: string; message: string; onOk(): void; onClose(): void }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="rn-dialog small" onMouseDown={(e) => e.stopPropagation()}>
        <div className="rn-dialog-title">{title}</div>
        <p>{message}</p>
        <div className="modal-buttons">
          <button onClick={onClose}>취소</button>
          <button className="rn-btn-danger" autoFocus onClick={onOk}>삭제</button>
        </div>
      </div>
    </div>
  );
}
