import { useEffect, useMemo, useRef, useState } from "react";
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceX, forceY, type SimulationNodeDatum } from "d3-force";
import { basename, type NoteFile } from "../vault";
import { parseWikiLinks, parseTags, resolveLink } from "../markdown";

interface Node extends SimulationNodeDatum {
  id: string;
  label: string;
  kind: "note" | "unresolved" | "tag";
  degree: number;
}
interface Link {
  source: string | Node;
  target: string | Node;
}

interface Props {
  files: NoteFile[];
  activePath: string | null;
  localOnly?: boolean;
  onOpen(path: string): void;
}

export default function GraphView({ files, activePath, localOnly, onOpen }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [showTags, setShowTags] = useState(false);
  const [showOrphans, setShowOrphans] = useState(true);
  const [showUnresolved, setShowUnresolved] = useState(false);
  const [filter, setFilter] = useState("");

  const graph = useMemo(() => {
    const nodes = new Map<string, Node>();
    const links: Link[] = [];
    files.forEach((f) => nodes.set(f.path, { id: f.path, label: basename(f.path), kind: "note", degree: 0 }));
    files.forEach((f) => {
      parseWikiLinks(f.content).forEach((l) => {
        let target = resolveLink(l.target, files);
        if (!target) {
          if (!showUnresolved) return;
          target = "unresolved:" + l.target;
          if (!nodes.has(target)) nodes.set(target, { id: target, label: l.target, kind: "unresolved", degree: 0 });
        }
        if (target !== f.path) links.push({ source: f.path, target });
      });
      if (showTags)
        parseTags(f.content).forEach((t) => {
          const id = "tag:" + t;
          if (!nodes.has(id)) nodes.set(id, { id, label: "#" + t, kind: "tag", degree: 0 });
          links.push({ source: f.path, target: id });
        });
    });
    links.forEach((l) => {
      nodes.get(l.source as string)!.degree++;
      nodes.get(l.target as string)!.degree++;
    });
    let list = [...nodes.values()];
    if (localOnly && activePath) {
      const near = new Set([activePath]);
      links.forEach((l) => {
        if (l.source === activePath) near.add(l.target as string);
        if (l.target === activePath) near.add(l.source as string);
      });
      list = list.filter((n) => near.has(n.id));
    }
    if (!showOrphans) list = list.filter((n) => n.degree > 0);
    if (filter) list = list.filter((n) => n.label.toLowerCase().includes(filter.toLowerCase()) || n.id === activePath);
    const keep = new Set(list.map((n) => n.id));
    return { nodes: list, links: links.filter((l) => keep.has(l.source as string) && keep.has(l.target as string)) };
  }, [files, showTags, showOrphans, showUnresolved, filter, localOnly, activePath]);

  useEffect(() => {
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    const nodes = graph.nodes.map((n) => ({ ...n }));
    const links = graph.links.map((l) => ({ ...l }));
    let view = { x: 0, y: 0, k: localOnly ? 1 : 1.4 };
    let hover: Node | null = null;
    let drag: Node | null = null;
    let pan: { x: number; y: number } | null = null;
    let moved = false;

    const resize = () => {
      const r = c.parentElement!.getBoundingClientRect();
      c.width = r.width * devicePixelRatio;
      c.height = r.height * devicePixelRatio;
      c.style.width = r.width + "px";
      c.style.height = r.height + "px";
    };
    resize();
    const ro = new ResizeObserver(() => {
      resize();
      draw();
    });
    ro.observe(c.parentElement!);

    const sim = forceSimulation<Node>(nodes)
      .force("link", forceLink<Node, Link>(links).id((d) => d.id).distance(70))
      .force("charge", forceManyBody().strength(-180))
      .force("center", forceCenter(0, 0))
      .force("collide", forceCollide(18))
      .force("x", forceX(0).strength(0.06))
      .force("y", forceY(0).strength(0.06));

    const css = getComputedStyle(c);
    const color = (name: string) => css.getPropertyValue(name).trim();
    const radius = (n: Node) => 4 + Math.sqrt(n.degree) * 2.2;
    const neighbors = (n: Node) => new Set(links.flatMap((l) => ((l.source as Node).id === n.id ? [(l.target as Node).id] : (l.target as Node).id === n.id ? [(l.source as Node).id] : [])));

    function draw() {
      const w = c.width, h = c.height, dpr = devicePixelRatio;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.setTransform(dpr * view.k, 0, 0, dpr * view.k, w / 2 + view.x * dpr, h / 2 + view.y * dpr);
      const near = hover ? neighbors(hover) : null;
      const dim = (id: string) => near && hover!.id !== id && !near.has(id);
      ctx.lineWidth = 1 / view.k;
      links.forEach((l) => {
        const s = l.source as Node, t = l.target as Node;
        const on = hover && (s.id === hover.id || t.id === hover.id);
        ctx.strokeStyle = on ? color("--graph-accent") : color("--graph-line");
        ctx.globalAlpha = near && !on ? 0.15 : 1;
        ctx.beginPath();
        ctx.moveTo(s.x!, s.y!);
        ctx.lineTo(t.x!, t.y!);
        ctx.stroke();
      });
      nodes.forEach((n) => {
        ctx.globalAlpha = dim(n.id) ? 0.2 : 1;
        ctx.fillStyle =
          n.id === activePath || n === hover ? color("--graph-accent") : n.kind === "tag" ? color("--graph-tag") : n.kind === "unresolved" ? color("--graph-unresolved") : color("--graph-node");
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, radius(n), 0, Math.PI * 2);
        ctx.fill();
        if (view.k > 0.6 || n === hover || n.id === activePath) {
          ctx.fillStyle = color("--graph-text");
          ctx.font = `${12 / Math.max(view.k, 0.8)}px sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(n.label, n.x!, n.y! + radius(n) + 14 / Math.max(view.k, 0.8));
        }
      });
      ctx.globalAlpha = 1;
    }
    sim.on("tick", draw);

    const toWorld = (e: MouseEvent) => {
      const r = c.getBoundingClientRect();
      return { x: (e.clientX - r.left - r.width / 2 - view.x) / view.k, y: (e.clientY - r.top - r.height / 2 - view.y) / view.k };
    };
    const pick = (e: MouseEvent) => {
      const p = toWorld(e);
      return nodes.find((n) => (n.x! - p.x) ** 2 + (n.y! - p.y) ** 2 < (radius(n) + 4) ** 2) ?? null;
    };
    const down = (e: MouseEvent) => {
      moved = false;
      drag = pick(e);
      if (drag) {
        sim.alphaTarget(0.3).restart();
        drag.fx = drag.x;
        drag.fy = drag.y;
      } else pan = { x: e.clientX - view.x, y: e.clientY - view.y };
    };
    const move = (e: MouseEvent) => {
      if (drag) {
        moved = true;
        const p = toWorld(e);
        drag.fx = p.x;
        drag.fy = p.y;
      } else if (pan) {
        moved = true;
        view = { ...view, x: e.clientX - pan.x, y: e.clientY - pan.y };
        draw();
      } else {
        const h = pick(e);
        if (h !== hover) {
          hover = h;
          c.style.cursor = h ? "pointer" : "grab";
          draw();
        }
      }
    };
    const up = () => {
      if (drag) {
        sim.alphaTarget(0);
        if (!moved && drag.kind === "note") onOpen(drag.id);
        drag.fx = null;
        drag.fy = null;
      }
      drag = null;
      pan = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const k = Math.min(4, Math.max(0.2, view.k * (e.deltaY < 0 ? 1.1 : 0.9)));
      view = { ...view, k };
      draw();
    };
    c.addEventListener("mousedown", down);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    c.addEventListener("wheel", wheel, { passive: false });
    return () => {
      sim.stop();
      ro.disconnect();
      c.removeEventListener("mousedown", down);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      c.removeEventListener("wheel", wheel);
    };
  }, [graph, activePath, onOpen, localOnly]);

  return (
    <div className="graph-view">
      <canvas ref={canvas} />
      <div className="graph-controls">
        <input className="search-input" placeholder="파일 이름으로 필터…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <label><input type="checkbox" checked={showTags} onChange={(e) => setShowTags(e.target.checked)} /> 태그 표시</label>
        <label><input type="checkbox" checked={showUnresolved} onChange={(e) => setShowUnresolved(e.target.checked)} /> 없는 노트 표시</label>
        <label><input type="checkbox" checked={showOrphans} onChange={(e) => setShowOrphans(e.target.checked)} /> 연결 없는 노트 표시</label>
      </div>
    </div>
  );
}
