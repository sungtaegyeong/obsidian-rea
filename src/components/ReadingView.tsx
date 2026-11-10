import { useEffect, useMemo, useRef } from "react";
import { renderMarkdown } from "../markdown";

export interface ReadingHandle {
  scrollToHeading(index: number): void;
}

interface Props {
  content: string;
  exists(target: string): boolean;
  onOpenLink(target: string, newTab: boolean): void;
  onTag(tag: string): void;
  onToggleTask(index: number): void;
  handleRef?: (h: ReadingHandle | null) => void;
}

export default function ReadingView({ content, exists, onOpenLink, onTag, onToggleTask, handleRef }: Props) {
  const html = useMemo(() => renderMarkdown(content, exists), [content, exists]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    handleRef?.({
      scrollToHeading(i) {
        ref.current?.querySelectorAll("h1,h2,h3,h4,h5,h6")[i]?.scrollIntoView({ behavior: "smooth", block: "start" });
      },
    });
    return () => handleRef?.(null);
  }, [handleRef]);

  return (
    <div
      ref={ref}
      className="rn-reader"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const el = e.target as HTMLElement;
        const link = el.closest<HTMLElement>("a.rn-wikilink");
        if (link) {
          e.preventDefault();
          onOpenLink(link.dataset.href!, e.metaKey || e.ctrlKey);
          return;
        }
        const tag = el.closest<HTMLElement>("a.rn-tag");
        if (tag) {
          e.preventDefault();
          onTag(tag.dataset.tag!);
          return;
        }
        if (el instanceof HTMLInputElement && el.dataset.task) {
          e.preventDefault();
          onToggleTask(+el.dataset.task);
        }
      }}
    />
  );
}
