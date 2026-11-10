import MarkdownIt from "markdown-it";
import { basename, type NoteFile } from "./vault";

// 코드 블록(``` ... ```)과 인라인 코드를 제외한 본문 영역만 남긴다
function stripCode(content: string): string {
  return content.replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, " ")).replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length));
}

const WIKILINK = /\[\[([^\]\n]+?)\]\]/g;

export interface WikiLink {
  target: string; // 링크 대상 이름 (헤딩·별칭 제외)
  display: string;
  index: number;
}

export function parseWikiLinks(content: string): WikiLink[] {
  const text = stripCode(content);
  const out: WikiLink[] = [];
  for (const m of text.matchAll(WIKILINK)) {
    const inner = m[1];
    const [targetPart, alias] = inner.split("|");
    const target = targetPart.split("#")[0].trim();
    if (target) out.push({ target, display: (alias ?? targetPart).trim(), index: m.index! });
  }
  return out;
}

export function parseTags(content: string): string[] {
  const text = stripCode(content);
  const tags = new Set<string>();
  for (const m of text.matchAll(/(^|\s)#([\p{L}\p{N}_\-/]+)/gu)) {
    if (!/^\d+$/.test(m[2])) tags.add(m[2]);
  }
  return [...tags];
}

export interface Heading {
  level: number;
  text: string;
  line: number; // 0부터 시작
}

export function parseHeadings(content: string): Heading[] {
  const out: Heading[] = [];
  let inFence = false;
  content.split("\n").forEach((line, i) => {
    if (/^```/.test(line)) inFence = !inFence;
    if (inFence) return;
    const m = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2], line: i });
  });
  return out;
}

export function countWords(content: string): { words: number; chars: number } {
  const text = content.replace(/```[\s\S]*?```/g, "").trim();
  return { words: text ? text.split(/\s+/).length : 0, chars: content.length };
}

// 링크 이름 → 파일 경로 (경로 일치 우선, 그다음 파일 이름 일치)
export function resolveLink(target: string, files: NoteFile[]): string | null {
  const t = target.replace(/\.md$/, "").toLowerCase();
  const byPath = files.find((f) => f.path.replace(/\.md$/, "").toLowerCase() === t);
  if (byPath) return byPath.path;
  const byName = files.find((f) => basename(f.path).toLowerCase() === t.split("/").pop());
  return byName ? byName.path : null;
}

// ---------- 읽기 모드 렌더링 ----------
const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// [[링크]]와 #태그를 인라인 토큰으로 처리하는 markdown-it 규칙
md.inline.ruler.before("link", "wikilink", (state, silent) => {
  const src = state.src.slice(state.pos);
  const m = /^\[\[([^\]\n]+?)\]\]/.exec(src);
  if (!m) return false;
  if (!silent) {
    const [targetPart, alias] = m[1].split("|");
    const token = state.push("wikilink", "a", 0);
    token.meta = { target: targetPart.split("#")[0].trim(), display: (alias ?? targetPart).trim() };
  }
  state.pos += m[0].length;
  return true;
});
md.renderer.rules.wikilink = (tokens, idx, _o, env) => {
  const { target, display } = tokens[idx].meta;
  const exists = (env as { exists?: (t: string) => boolean }).exists?.(target) ?? true;
  return `<a class="internal-link${exists ? "" : " is-unresolved"}" data-href="${esc(target)}">${esc(display)}</a>`;
};

md.inline.ruler.before("emphasis", "hashtag", (state, silent) => {
  if (state.src[state.pos] !== "#") return false;
  const prev = state.pos === 0 ? " " : state.src[state.pos - 1];
  if (!/\s/.test(prev)) return false;
  const m = /^#([\p{L}\p{N}_\-/]+)/u.exec(state.src.slice(state.pos));
  if (!m || /^\d+$/.test(m[1])) return false;
  if (!silent) {
    const token = state.push("hashtag", "a", 0);
    token.content = m[1];
  }
  state.pos += m[0].length;
  return true;
});
md.renderer.rules.hashtag = (tokens, idx) => `<a class="tag" data-tag="${esc(tokens[idx].content)}">#${esc(tokens[idx].content)}</a>`;

export function renderMarkdown(content: string, exists: (target: string) => boolean): string {
  let taskIndex = 0;
  const html = md.render(content, { exists });
  // 체크리스트 "- [ ]" / "- [x]"를 체크박스로 바꾼다 (data-task: 문서 안 순번)
  return html.replace(/<li>(<p>)?\[( |x|X)\]\s?/g, (_m, p, mark) => {
    const checked = mark.toLowerCase() === "x";
    return `<li class="task-list-item${checked ? " is-checked" : ""}">${p ?? ""}<input type="checkbox" class="task-list-item-checkbox" data-task="${taskIndex++}"${checked ? " checked" : ""}> `;
  });
}

// n번째 체크박스 상태를 원문에서 뒤집는다
export function toggleTask(content: string, n: number): string {
  let i = 0;
  return content.replace(/^(\s*[-*+]\s+\[)( |x|X)(\])/gm, (m, a, mark, b) => (i++ === n ? a + (mark === " " ? "x" : " ") + b : m));
}
