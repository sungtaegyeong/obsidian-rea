import { useEffect, useMemo, useRef, useState } from "react";

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

interface PickerProps {
  placeholder: string;
  items: PickerItem[];
  emptyAction?: (query: string) => PickerItem | null;
  instructions: [string, string][];
  onPick(item: PickerItem, query: string, mod: boolean): void;
  onClose(): void;
}

export function PickerModal({ placeholder, items, emptyAction, instructions, onPick, onClose }: PickerProps) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const list = useMemo(() => {
    const scored = items
      .map((it) => ({ it, m: fuzzy(query, it.label) }))
      .filter((x) => x.m)
      .sort((a, b) => (query ? b.m!.score - a.m!.score : 0));
    const out = scored.map((x) => ({ ...x.it, idx: x.m!.idx }));
    if (query && emptyAction && !items.some((i) => i.label.toLowerCase() === query.toLowerCase())) {
      const extra = emptyAction(query);
      if (extra) out.push({ ...extra, idx: [] });
    }
    return out.slice(0, 50);
  }, [items, query, emptyAction]);

  useEffect(() => setSel(0), [query]);
  useEffect(() => {
    listRef.current?.children[sel]?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="rn-palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="rn-palette-input"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, list.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            else if (e.key === "Enter" && list[sel]) { e.preventDefault(); onPick(list[sel], query, e.metaKey || e.ctrlKey); }
            else if (e.key === "Escape") onClose();
          }}
        />
        <div className="rn-palette-list" ref={listRef}>
          {list.map((it, i) => (
            <div key={it.id} className={`rn-pick${i === sel ? " rn-picked" : ""}`} onMouseEnter={() => setSel(i)} onClick={(e) => onPick(it, query, e.metaKey || e.ctrlKey)}>
              <div className="rn-pick-body">
                <div className="rn-pick-title"><Highlight text={it.label} idx={it.idx} /></div>
                {it.note && <div className="rn-pick-note">{it.note}</div>}
              </div>
              {it.hotkey && <kbd>{it.hotkey}</kbd>}
            </div>
          ))}
          {!list.length && <div className="rn-pick-empty">일치하는 항목이 없습니다</div>}
        </div>
        <div className="rn-palette-hints">
          {instructions.map(([k, v]) => (
            <span key={k}><kbd>{k}</kbd> {v}</span>
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
