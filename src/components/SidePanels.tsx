import { useMemo, useState } from "react";
import { CaseSensitive, Regex, Search, CircleX, ChevronDown, ChevronRight } from "lucide-react";
import { basename, type NoteFile } from "../vault";
import { parseHeadings, parseTags, parseWikiLinks, resolveLink } from "../markdown";

// ---------- 전체 검색 ----------
interface SearchProps {
  files: NoteFile[];
  query: string;
  setQuery(q: string): void;
  onOpen(path: string, line?: number): void;
}

export function SearchPanel({ files, query, setQuery, onOpen }: SearchProps) {
  const [matchCase, setMatchCase] = useState(false);
  const [regex, setRegex] = useState(false);

  const { results, error } = useMemo(() => {
    const q = query.trim();
    if (!q) return { results: [], error: null };
    // tag:#태그, file:이름, path:경로 연산자 지원
    const tagOp = /^tag:#?(.+)$/.exec(q);
    const fileOp = /^file:(.+)$/.exec(q);
    const pathOp = /^path:(.+)$/.exec(q);
    try {
      const re = regex ? new RegExp(q, matchCase ? "g" : "gi") : null;
      const out: { file: NoteFile; hits: { line: number; text: string }[]; nameHit: boolean }[] = [];
      for (const f of files) {
        if (tagOp) {
          if (parseTags(f.content).some((t) => t.toLowerCase() === tagOp[1].toLowerCase()))
            out.push({ file: f, nameHit: false, hits: f.content.split("\n").flatMap((l, i) => (l.includes("#" + tagOp[1]) ? [{ line: i, text: l }] : [])) });
          continue;
        }
        if (fileOp || pathOp) {
          const hay = fileOp ? basename(f.path) : f.path;
          if (hay.toLowerCase().includes((fileOp ?? pathOp)![1].toLowerCase())) out.push({ file: f, nameHit: true, hits: [] });
          continue;
        }
        const test = (s: string) => (re ? (re.lastIndex = 0, re.test(s)) : matchCase ? s.includes(q) : s.toLowerCase().includes(q.toLowerCase()));
        const hits = f.content.split("\n").flatMap((l, i) => (test(l) ? [{ line: i, text: l }] : []));
        const nameHit = test(basename(f.path));
        if (hits.length || nameHit) out.push({ file: f, hits, nameHit });
      }
      return { results: out, error: null };
    } catch (e) {
      return { results: [], error: (e as Error).message };
    }
  }, [files, query, matchCase, regex]);

  // 한 줄 안의 일치 위치를 모두 찾는다 (원본처럼 일치 횟수를 세고, 모두 강조)
  const ranges = (text: string): [number, number][] => {
    const q = query.trim();
    if (!q || /^(tag|file|path):/.test(q)) return [];
    if (regex) {
      try {
        return [...text.matchAll(new RegExp(q, matchCase ? "g" : "gi"))].filter((m) => m[0].length).map((m) => [m.index!, m.index! + m[0].length]);
      } catch {
        return [];
      }
    }
    const hay = matchCase ? text : text.toLowerCase(), needle = matchCase ? q : q.toLowerCase();
    const out: [number, number][] = [];
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) out.push([i, i + needle.length]);
    return out;
  };
  const highlight = (text: string) => {
    const rs = ranges(text);
    if (!rs.length) return text;
    const parts: React.ReactNode[] = [];
    let at = 0;
    rs.forEach(([a, b], k) => {
      parts.push(text.slice(at, a), <mark key={k}>{text.slice(a, b)}</mark>);
      at = b;
    });
    parts.push(text.slice(at));
    return <>{parts}</>;
  };
  const countOf = (r: (typeof results)[number]) => {
    const n = r.hits.reduce((acc, h) => acc + Math.max(1, ranges(h.text).length), 0);
    return n || (r.nameHit ? 1 : 0);
  };

  const [folded, setFolded] = useState<Set<string>>(new Set());
  const sorted = useMemo(() => [...results].sort((a, b) => basename(a.file.path).localeCompare(basename(b.file.path), "ko", { numeric: true })), [results]);
  // 전체 개수에는 파일 이름 일치도 더한다 (원본 관찰: 본문 16 + 이름 2 = 18)
  const total = results.reduce((n, r) => n + countOf(r) + (r.nameHit && r.hits.length ? 1 : 0), 0);
  const OPS: [string, string][] = [["path:", "일치하는 파일 경로"], ["file:", "일치하는 파일 이름"], ["tag:", "태그 검색"]];

  return (
    <div className="panel search-panel">
      <div className="search-input-row">
        <label className="rn-search-box">
          <Search size={16} />
          <input autoFocus placeholder="입력하여 검색하기…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className={`toggle${matchCase ? " rn-current" : ""}`} title="대소문자 구분" onClick={() => setMatchCase(!matchCase)}><CaseSensitive size={16} /></button>
          <button className={`toggle${regex ? " rn-current" : ""}`} title="정규식 사용" onClick={() => setRegex(!regex)}><Regex size={15} /></button>
          {query && <button className="toggle rn-search-clear" title="지우기" onClick={() => setQuery("")}><CircleX size={16} /></button>}
        </label>
      </div>
      {!query.trim() && (
        <div className="rn-search-ops">
          <div className="rn-search-ops-title">검색 옵션</div>
          {OPS.map(([op, desc]) => (
            <div key={op} className="rn-search-op" onClick={() => setQuery(op)}><b>{op}</b> {desc}</div>
          ))}
        </div>
      )}
      {error && <div className="search-error">정규식 오류: {error}</div>}
      {query.trim() && <div className="search-count">{total} 개의 결과 <span className="search-sort">파일 이름 (가나다순)</span></div>}
      <div className="rn-hits">
        {query.trim() && !error && !results.length && <div className="empty">일치하는 결과가 없습니다.</div>}
        {sorted.map((r) => {
          const { file, hits } = r;
          const closed = folded.has(file.path);
          return (
            <div key={file.path} className="rn-hit">
              <div className="rn-hit-file">
                <span className="rn-hit-fold" onClick={() => setFolded((f) => { const n = new Set(f); n.has(file.path) ? n.delete(file.path) : n.add(file.path); return n; })}>
                  {closed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                </span>
                <span className="rn-hit-name" onClick={() => onOpen(file.path)}>{highlight(basename(file.path))}</span>
                <span className="count">{countOf(r)}</span>
              </div>
              {!closed && hits.length > 0 && (
                <div className="rn-hit-lines">
                  {hits.map((h) => (
                    <div key={h.line} className="rn-hit-line" onClick={() => onOpen(file.path, h.line)}>
                      {highlight(h.text.trim())}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- 태그 ----------
export function TagsPanel({ files, onTag }: { files: NoteFile[]; onTag(tag: string): void }) {
  const tags = useMemo(() => {
    const count = new Map<string, number>();
    files.forEach((f) => parseTags(f.content).forEach((t) => count.set(t, (count.get(t) ?? 0) + 1)));
    return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"));
  }, [files]);
  return (
    <div className="panel">
      {tags.map(([t, n]) => (
        <div key={t} className="tag-row" onClick={() => onTag(t)}>
          <span>#{t}</span>
          <span className="count">{n}</span>
        </div>
      ))}
      {!tags.length && <div className="empty">태그가 없습니다</div>}
    </div>
  );
}

// ---------- 백링크 ----------
export function BacklinksPanel({ files, path, onOpen }: { files: NoteFile[]; path: string | null; onOpen(path: string, line?: number): void }) {
  const { linked, unlinked } = useMemo(() => {
    if (!path) return { linked: [], unlinked: [] };
    const name = basename(path);
    const linked: { file: NoteFile; lines: { line: number; text: string }[] }[] = [];
    const unlinked: { file: NoteFile; lines: { line: number; text: string }[] }[] = [];
    for (const f of files) {
      if (f.path === path) continue;
      const links = parseWikiLinks(f.content).filter((l) => resolveLink(l.target, files) === path);
      const lines = f.content.split("\n");
      if (links.length) {
        linked.push({ file: f, lines: lines.flatMap((l, i) => (/\[\[/.test(l) && parseWikiLinks(l).some((x) => resolveLink(x.target, files) === path) ? [{ line: i, text: l }] : [])) });
      } else {
        // 링크 안 된 언급: 본문에 노트 이름이 그대로 등장
        const hits = lines.flatMap((l, i) => (l.includes(name) ? [{ line: i, text: l }] : []));
        if (hits.length) unlinked.push({ file: f, lines: hits });
      }
    }
    return { linked, unlinked };
  }, [files, path]);

  const [unlinkedOpen, setUnlinkedOpen] = useState(false);
  const [folded, setFolded] = useState<Set<string>>(new Set());
  if (!path) return <div className="panel empty">열린 노트가 없습니다</div>;
  const toggle = (k: string) => setFolded((f) => { const n = new Set(f); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const list = (items: typeof linked) =>
    items.map(({ file, lines }) => (
      <div key={file.path} className="rn-hit">
        <div className="rn-hit-file">
          <span className="rn-hit-fold" onClick={() => toggle(file.path)}>{folded.has(file.path) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</span>
          <span className="rn-hit-name" onClick={() => onOpen(file.path)}>{basename(file.path)}</span>
          <span className="count">{lines.length}</span>
        </div>
        {lines.length > 0 && !folded.has(file.path) && (
          <div className="rn-hit-lines">
            {lines.map((l) => (
              <div key={l.line} className="rn-hit-line" onClick={() => onOpen(file.path, l.line)}>{l.text.trim()}</div>
            ))}
          </div>
        )}
      </div>
    ));
  return (
    <div className="panel">
      <div className="panel-section-title">
        <span>링크된 언급</span> <span className="count">{linked.length}</span>
      </div>
      {linked.length ? list(linked) : <div className="empty">백링크를 찾지 못했습니다.</div>}
      <div className="panel-section-title is-toggle" onClick={() => setUnlinkedOpen((o) => !o)}>
        <span>링크되지 않은 언급</span> {unlinkedOpen && <span className="count">{unlinked.length}</span>}
      </div>
      {unlinkedOpen && (unlinked.length ? list(unlinked) : <div className="empty">링크되지 않은 언급이 없습니다.</div>)}
    </div>
  );
}

// ---------- 개요 ----------
export function OutlinePanel({ content, onJump }: { content: string | null; onJump(index: number, line: number): void }) {
  const heads = useMemo(() => (content ? parseHeadings(content) : []), [content]);
  if (!heads.length) return <div className="panel empty">제목이 없습니다</div>;
  const min = Math.min(...heads.map((h) => h.level));
  return (
    <div className="panel">
      {heads.map((h, i) => (
        <div key={i} className="outline-item" style={{ paddingLeft: 8 + (h.level - min) * 14 }} onClick={() => onJump(i, h.line)}>
          {h.text}
        </div>
      ))}
    </div>
  );
}
