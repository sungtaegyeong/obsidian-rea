import { useMemo, useState } from "react";
import { CaseSensitive, Regex } from "lucide-react";
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

  const highlight = (text: string) => {
    const q = query.trim();
    if (!q || regex || /^(tag|file|path):/.test(q)) return text;
    const i = (matchCase ? text : text.toLowerCase()).indexOf(matchCase ? q : q.toLowerCase());
    if (i < 0) return text;
    return (
      <>
        {text.slice(0, i)}
        <mark>{text.slice(i, i + q.length)}</mark>
        {text.slice(i + q.length)}
      </>
    );
  };

  return (
    <div className="panel search-panel">
      <div className="search-input-row">
        <input autoFocus className="search-input" placeholder="검색어 입력…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className={`toggle${matchCase ? " is-active" : ""}`} title="대소문자 구분" onClick={() => setMatchCase(!matchCase)}><CaseSensitive size={16} /></button>
        <button className={`toggle${regex ? " is-active" : ""}`} title="정규식 사용" onClick={() => setRegex(!regex)}><Regex size={16} /></button>
      </div>
      <div className="search-hint">연산자: tag:#태그 · file:이름 · path:경로</div>
      {error && <div className="search-error">정규식 오류: {error}</div>}
      {query.trim() && <div className="search-count">{results.length}개 파일에서 일치</div>}
      <div className="search-results">
        {results.map(({ file, hits }) => (
          <div key={file.path} className="search-result">
            <div className="search-result-file" onClick={() => onOpen(file.path)}>
              <span>{highlight(basename(file.path))}</span> <span className="count">{hits.length}</span>
            </div>
            {hits.slice(0, 5).map((h) => (
              <div key={h.line} className="search-result-match" onClick={() => onOpen(file.path, h.line)}>
                {highlight(h.text.trim())}
              </div>
            ))}
          </div>
        ))}
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

  if (!path) return <div className="panel empty">열린 노트가 없습니다</div>;
  const section = (title: string, items: typeof linked) => (
    <>
      <div className="panel-section-title">
        {title} <span className="count">{items.length}</span>
      </div>
      {items.map(({ file, lines }) => (
        <div key={file.path} className="search-result">
          <div className="search-result-file" onClick={() => onOpen(file.path)}>{basename(file.path)}</div>
          {lines.slice(0, 3).map((l) => (
            <div key={l.line} className="search-result-match" onClick={() => onOpen(file.path, l.line)}>{l.text.trim()}</div>
          ))}
        </div>
      ))}
      {!items.length && <div className="empty">없음</div>}
    </>
  );
  return (
    <div className="panel">
      {section("연결된 언급", linked)}
      {section("연결되지 않은 언급", unlinked)}
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
