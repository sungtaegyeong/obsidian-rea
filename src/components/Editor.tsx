import { useEffect, useRef } from "react";
import { EditorState, Compartment, RangeSetBuilder, type Extension } from "@codemirror/state";
import { WidgetType } from "@codemirror/view";
import {
  EditorView,
  keymap,
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
  drawSelection,
  highlightActiveLine,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree, syntaxHighlighting, HighlightStyle, indentOnInput } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { tags as t } from "@lezer/highlight";

export interface EditorHandle {
  scrollToLine(line: number): void;
  focus(): void;
}

interface Props {
  docKey: string;
  value: string;
  livePreview: boolean;
  onChange(value: string): void;
  onOpenLink(target: string, newTab: boolean): void;
  handleRef?: (h: EditorHandle | null) => void;
}

const highlight = HighlightStyle.define([
  { tag: t.heading1, class: "cm-h1" },
  { tag: t.heading2, class: "cm-h2" },
  { tag: t.heading3, class: "cm-h3" },
  { tag: [t.heading4, t.heading5, t.heading6], class: "cm-h4" },
  { tag: t.strong, class: "rn-md-strong" },
  { tag: t.emphasis, class: "rn-md-em" },
  { tag: t.strikethrough, class: "cm-strike" },
  { tag: t.monospace, class: "rn-md-code" },
  { tag: t.link, class: "rn-md-link" },
  { tag: t.url, class: "rn-md-url" },
  { tag: t.quote, class: "rn-md-quote" },
  { tag: [t.processingInstruction, t.meta], class: "rn-md-mark" },
  { tag: t.list, class: "cm-list" },
]);

// [[위키링크]]와 #태그에 표시용 클래스를 붙인다 (모든 모드 공통)
const linkAndTagMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
    }
    build(view: EditorView) {
      const b = new RangeSetBuilder<Decoration>();
      for (const { from, to } of view.visibleRanges) {
        const text = view.state.doc.sliceString(from, to);
        const marks: [number, number, string][] = [];
        for (const m of text.matchAll(/\[\[[^\]\n]+?\]\]/g)) marks.push([from + m.index!, from + m.index! + m[0].length, "cm-wikilink"]);
        for (const m of text.matchAll(/(^|\s)(#[\p{L}\p{N}_\-/]+)/gu)) {
          const s = from + m.index! + m[1].length;
          if (!/^#\d+$/.test(m[2])) marks.push([s, s + m[2].length, "rn-md-tag"]);
        }
        marks.sort((a, c) => a[0] - c[0]).forEach(([s, e, cls]) => b.add(s, e, Decoration.mark({ class: cls })));
      }
      return b.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

// 실시간 미리보기: 커서가 없는 줄에서는 마크다운 기호(#, **, *, `, [[ ]])를 숨긴다
const hide = Decoration.replace({});
class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-bullet";
    el.textContent = "•";
    return el;
  }
}
const bullet = Decoration.replace({ widget: new BulletWidget() });
// 할 일 체크박스: 클릭하면 [ ] ↔ [x]를 바꾼다
class TaskWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly markerFrom: number) {
    super();
  }
  eq(o: TaskWidget) {
    return o.checked === this.checked && o.markerFrom === this.markerFrom;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("input");
    el.type = "checkbox";
    el.className = "cm-task-checkbox";
    el.checked = this.checked;
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ changes: { from: this.markerFrom + 1, to: this.markerFrom + 2, insert: this.checked ? " " : "x" } });
    });
    return el;
  }
  ignoreEvent() {
    return true;
  }
}
const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged) this.decorations = this.build(u.view);
    }
    build(view: EditorView) {
      const { state } = view;
      const activeLines = new Set<number>();
      if (view.hasFocus) for (const r of state.selection.ranges) {
        const a = state.doc.lineAt(r.from).number, z = state.doc.lineAt(r.to).number;
        for (let n = a; n <= z; n++) activeLines.add(n);
      }
      const ranges: [number, number][] = [];
      const bullets: number[] = [];
      const tasks: [number, number, Decoration][] = [];
      for (const { from, to } of view.visibleRanges) {
        syntaxTree(state).iterate({
          from,
          to,
          enter: (node) => {
            const name = node.name;
            const line = state.doc.lineAt(node.from).number;
            if (activeLines.has(line)) return;
            if (name === "HeaderMark") {
              const end = Math.min(node.to + 1, state.doc.lineAt(node.from).to);
              ranges.push([node.from, end]);
            } else if (name === "EmphasisMark" || name === "StrikethroughMark") {
              ranges.push([node.from, node.to]);
            } else if (name === "ListMark" && node.node.nextSibling?.name === "Task") {
              const marker = node.node.nextSibling.firstChild;
              if (marker?.name === "TaskMarker") {
                const checked = /x/i.test(state.doc.sliceString(marker.from, marker.to));
                tasks.push([node.from, marker.to, Decoration.replace({ widget: new TaskWidget(checked, marker.from) })]);
              }
            } else if (name === "ListMark" && node.node.parent?.parent?.name === "BulletList") {
              bullets.push(node.from); // 글머리 기호(-, *, +)를 점으로 바꿔 보여준다
            } else if (name === "CodeMark" && node.node.parent?.name === "InlineCode") {
              ranges.push([node.from, node.to]);
            }
          },
        });
        const text = state.doc.sliceString(from, to);
        for (const m of text.matchAll(/\[\[([^\]\n|]+\|)?[^\]\n]*?\]\]/g)) {
          const s = from + m.index!;
          if (activeLines.has(state.doc.lineAt(s).number)) continue;
          ranges.push([s, s + 2 + (m[1]?.length ?? 0)]);
          ranges.push([s + m[0].length - 2, s + m[0].length]);
        }
      }
      const b = new RangeSetBuilder<Decoration>();
      const merged = ranges
        .sort((a, c) => a[0] - c[0] || a[1] - c[1])
        .reduce<[number, number][]>((acc, r) => {
          const last = acc[acc.length - 1];
          if (last && r[0] < last[1]) last[1] = Math.max(last[1], r[1]);
          else acc.push([...r]);
          return acc;
        }, [])
        .filter(([s, e]) => e > s)
        .map(([s, e]) => [s, e, hide] as [number, number, Decoration]);
      const all = [...merged, ...tasks, ...bullets.map((s) => [s, s + 1, bullet] as [number, number, Decoration])];
      all.sort((a, c) => a[0] - c[0]).forEach(([s, e, d]) => b.add(s, e, d));
      return b.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

// 제목 줄에 크기 클래스를 붙인다 (편집 모드에서도 제목이 크게 보이도록)
const headingLines = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
    }
    build(view: EditorView) {
      const b = new RangeSetBuilder<Decoration>();
      const done = new Set<number>();
      for (const { from, to } of view.visibleRanges) {
        syntaxTree(view.state).iterate({
          from,
          to,
          enter: (node) => {
            const m = /^ATXHeading(\d)$/.exec(node.name);
            const line = view.state.doc.lineAt(node.from);
            if (done.has(line.from)) return;
            if (m) {
              done.add(line.from);
              b.add(line.from, line.from, Decoration.line({ class: `cm-line-h${Math.min(+m[1], 4)}` }));
            } else if (node.name === "ListItem") {
              // 목록 줄: 줄이 넘치면 글머리표 뒤 글자 위치에 맞춰 들여쓴다. 완료한 할 일은 표시 클래스를 더한다
              done.add(line.from);
              const marker = node.node.getChild("Task")?.getChild("TaskMarker");
              const checked = !!marker && /x/i.test(view.state.doc.sliceString(marker.from, marker.to));
              b.add(line.from, line.from, Decoration.line({ class: checked ? "rn-list-line rn-task-line-done" : "rn-list-line" }));
            }
          },
        });
      }
      return b.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

export default function Editor({ docKey, value, livePreview, onChange, onOpenLink, handleRef }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const lp = useRef(new Compartment());
  const cb = useRef({ onChange, onOpenLink });
  cb.current = { onChange, onOpenLink };

  useEffect(() => {
    const extensions: Extension[] = [
      history(),
      drawSelection(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      indentOnInput(),
      EditorView.lineWrapping,
      markdown({ base: markdownLanguage }),
      syntaxHighlighting(highlight),
      headingLines,
      linkAndTagMarks,
      lp.current.of(livePreview ? livePreviewPlugin : []),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) cb.current.onChange(u.state.doc.toString());
      }),
      EditorView.domEventHandlers({
        mousedown(e, v) {
          if (!(e.metaKey || e.ctrlKey)) return false;
          const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
          if (pos == null) return false;
          const line = v.state.doc.lineAt(pos);
          for (const m of line.text.matchAll(/\[\[([^\]\n]+?)\]\]/g)) {
            const s = line.from + m.index!, end = s + m[0].length;
            if (pos >= s && pos <= end) {
              e.preventDefault();
              cb.current.onOpenLink(m[1].split("|")[0].split("#")[0].trim(), e.altKey);
              return true;
            }
          }
          return false;
        },
      }),
    ];
    const v = new EditorView({ state: EditorState.create({ doc: value, extensions }), parent: host.current! });
    view.current = v;
    handleRef?.({
      scrollToLine(n) {
        const line = v.state.doc.line(Math.min(n + 1, v.state.doc.lines));
        v.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: "start", yMargin: 24 }) });
        v.focus();
      },
      focus: () => v.focus(),
    });
    return () => {
      handleRef?.(null);
      v.destroy();
    };
    // 파일이 바뀔 때만 에디터를 새로 만든다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  // 외부에서 내용이 바뀐 경우(체크박스 토글, 이름 바꾸기 등) 동기화
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: lp.current.reconfigure(livePreview ? livePreviewPlugin : []) });
  }, [livePreview]);

  return <div className={`editor-host${livePreview ? " rn-lp" : " is-source"}`} ref={host} />;
}
