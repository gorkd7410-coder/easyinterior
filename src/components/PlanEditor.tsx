"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { centroid, dist, orthoSnap, pointInPolygon, polygonArea, projectToSegment, uid } from "@/lib/geometry";
import { getMaterial, finishFor } from "@/lib/materials";
import { roomAreaM2 } from "@/lib/project";
import { ITEM_SPECS, itemCorners } from "@/lib/fixtures";
import type { InfillKind, Opening, OpeningKind, Project, Pt } from "@/lib/types";
import { OPENING_DEFAULTS } from "@/lib/types";

export type Tool = "select" | "room" | "door" | "window" | "open" | "scale" | "pick" | "item";
export type Selection = { kind: "room" | "opening" | "infill" | "item"; id: string } | null;

type Props = {
  project: Project;
  tool: Tool;
  selection: Selection;
  onSelect: (s: Selection) => void;
  /** commit=true면 바뀌기 전 상태를 실행취소 기록에 남긴다 */
  onChange: (p: Project, commit: boolean) => void;
  onToolDone: () => void;
  onScaleMeasured: (pxLength: number) => void;
  /** '방 클릭 인식' 도구로 평면도 위를 클릭했을 때 */
  onPick: (p: Pt) => void;
  /** '설비 놓기' 도구로 클릭했을 때 */
  onPlace: (p: Pt) => void;
};

type ViewBox = { x: number; y: number; w: number; h: number };
type EdgeHit = { a: Pt; b: Pt; pt: Pt; d: number };

const INFILL_COLOR: Record<InfillKind, string> = { door: "#c026d3", window: "#f59e0b", floorWindow: "#2563eb" };
const OPENING_COLOR: Record<OpeningKind, string> = { door: "#b45309", window: "#0284c7", open: "#16a34a" };

export default function PlanEditor({ project, tool, selection, onSelect, onChange, onToolDone, onScaleMeasured, onPick, onPlace }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const bounds = project.image ?? project.canvas;
  const [vb, setVb] = useState<ViewBox>({ x: 0, y: 0, w: bounds.width, h: bounds.height });
  const [draft, setDraft] = useState<Pt[]>([]);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [shift, setShift] = useState(false);
  const drag = useRef<
    | { kind: "pan"; start: Pt; vb: ViewBox }
    | { kind: "vertex"; refs: { roomId: string; idx: number }[]; base: Project; moved: boolean }
    | { kind: "openEnd"; id: string; end: "a" | "b"; base: Project; moved: boolean }
    | { kind: "item"; id: string; base: Project; dx: number; dy: number; moved: boolean }
    | null
  >(null);

  const [panning, setPanning] = useState(false);
  const [size, setSize] = useState({ w: 1, h: 1 });

  // 이미지/템플릿이 바뀌면 화면 맞춤, 도구가 바뀌면 그리던 것 취소
  const fitKey = `${bounds.width}x${bounds.height}:${project.image?.dataUrl.length ?? 0}`;
  const [prevFitKey, setPrevFitKey] = useState(fitKey);
  if (fitKey !== prevFitKey) {
    setPrevFitKey(fitKey);
    setVb({ x: -bounds.width * 0.03, y: -bounds.height * 0.03, w: bounds.width * 1.06, h: bounds.height * 1.06 });
  }
  const [prevTool, setPrevTool] = useState(tool);
  if (tool !== prevTool) {
    setPrevTool(tool);
    setDraft([]);
  }

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width || 1, h: e.contentRect.height || 1 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** 화면 1px이 평면 몇 px인지 */
  const pxPerScreen = useCallback(() => Math.max(vb.w / size.w, vb.h / size.h), [vb, size]);

  const toPlan = (e: { clientX: number; clientY: number }): Pt => {
    const el = svgRef.current!;
    const m = el.getScreenCTM()!.inverse();
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    return { x: p.x, y: p.y };
  };

  const allVertices = useMemo(() => project.rooms.flatMap((r) => r.points), [project.rooms]);

  const snapVertex = (p: Pt): Pt | null => {
    const tol = 10 * pxPerScreen();
    let best: Pt | null = null;
    let bd = tol;
    for (const v of [...allVertices, ...draft]) {
      const d = dist(p, v);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  };

  const nearestEdge = (p: Pt): EdgeHit | null => {
    let best: EdgeHit | null = null;
    for (const r of project.rooms) {
      for (let i = 0; i < r.points.length; i++) {
        const a = r.points[i];
        const b = r.points[(i + 1) % r.points.length];
        const hit = projectToSegment(p, a, b);
        if (!best || hit.d < best.d) best = { a, b, pt: hit.pt, d: hit.d };
      }
    }
    return best && best.d < 18 * pxPerScreen() ? best : null;
  };

  /** 그리는 중인 점 위치 (꼭짓점 스냅 > 직교 스냅) */
  const roomPoint = (raw: Pt): Pt => {
    const v = snapVertex(raw);
    if (v) return v;
    const last = draft[draft.length - 1];
    if (last && !shift) {
      const o = orthoSnap(raw, last);
      // 직교 맞춘 뒤에도 다른 꼭짓점과 줄 맞추기
      const tol = 8 * pxPerScreen();
      for (const q of allVertices) {
        if (o.x === last.x && Math.abs(o.y - q.y) < tol) return { x: o.x, y: q.y };
        if (o.y === last.y && Math.abs(o.x - q.x) < tol) return { x: q.x, y: o.y };
      }
      return o;
    }
    return raw;
  };

  const openingPoint = (raw: Pt): Pt | null => {
    if (draft.length === 1) {
      // 두 번째 점은 첫 점이 놓인 벽선 위로 투영
      const e = nearestEdge(draft[0]);
      if (!e) return null;
      const dx = e.b.x - e.a.x;
      const dy = e.b.y - e.a.y;
      const len2 = dx * dx + dy * dy;
      const t = ((raw.x - e.a.x) * dx + (raw.y - e.a.y) * dy) / len2;
      return { x: e.a.x + dx * t, y: e.a.y + dy * t };
    }
    return nearestEdge(raw)?.pt ?? null;
  };

  const finishRoom = (pts: Pt[]) => {
    if (pts.length < 3 || polygonArea(pts) < 1) return;
    const n = project.rooms.length + 1;
    const f = finishFor("bedroom");
    const room = { id: uid(), name: `방${n}`, type: "bedroom" as const, points: pts, floorMat: f.floor, wallMat: f.wall };
    onChange({ ...project, rooms: [...project.rooms, room] }, true);
    onSelect({ kind: "room", id: room.id });
    setDraft([]);
    onToolDone();
  };

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      setShift(e.shiftKey);
      if (e.type !== "keydown") return;
      const target = e.target as HTMLElement;
      if (target.closest("input,textarea,select")) return;
      if (e.key === "Escape") setDraft([]);
      if (e.key === "Enter" && tool === "room") finishRoom(draft);
      if (e.key === "Backspace" && draft.length) {
        e.preventDefault();
        setDraft((d) => d.slice(0, -1));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, tool, project],
  );
  useEffect(() => {
    window.addEventListener("keydown", handleKey);
    window.addEventListener("keyup", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("keyup", handleKey);
    };
  }, [handleKey]);

  const onWheel = (e: React.WheelEvent) => {
    const p = toPlan(e);
    const k = Math.exp(e.deltaY * 0.0015);
    setVb((v) => ({ x: p.x - (p.x - v.x) * k, y: p.y - (p.y - v.y) * k, w: v.w * k, h: v.h * k }));
  };

  const hitOpening = (p: Pt): Opening | null => {
    const tol = 8 * pxPerScreen();
    let best: Opening | null = null;
    let bd = tol;
    for (const o of project.openings) {
      const d = projectToSegment(p, o.a, o.b).d;
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  };

  const hitRoom = (p: Pt) =>
    project.rooms
      .filter((r) => pointInPolygon(p, r.points))
      .sort((a, b) => polygonArea(a.points) - polygonArea(b.points))[0] ?? null;

  const onPointerDown = (e: React.PointerEvent) => {
    const p = toPlan(e);
    const pan = e.button === 1 || (e.button === 0 && e.altKey);
    if (pan) {
      drag.current = { kind: "pan", start: { x: e.clientX, y: e.clientY }, vb };
      setPanning(true);
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    if (e.button !== 0) return;

    if (tool === "room") {
      const q = roomPoint(p);
      if (draft.length >= 3 && dist(q, draft[0]) < 10 * pxPerScreen()) return finishRoom(draft);
      setDraft([...draft, q]);
      return;
    }
    if (tool === "door" || tool === "window" || tool === "open") {
      const q = openingPoint(p);
      if (!q) return;
      if (draft.length === 0) return setDraft([q]);
      if (dist(q, draft[0]) * project.mmPerPx < 100) return;
      const o: Opening = { id: uid(), kind: tool, a: draft[0], b: q, ...OPENING_DEFAULTS[tool] };
      onChange({ ...project, openings: [...project.openings, o] }, true);
      onSelect({ kind: "opening", id: o.id });
      setDraft([]);
      return;
    }
    if (tool === "item") {
      onPlace(p);
      return;
    }
    if (tool === "pick") {
      onPick(p);
      return;
    }
    if (tool === "scale") {
      const q = snapVertex(p) ?? p;
      if (draft.length === 0) return setDraft([q]);
      onScaleMeasured(dist(draft[0], q));
      setDraft([]);
      onToolDone();
      return;
    }

    // select: 꼭짓점 > 개구부 > 방 > 빈 곳(화면 이동)
    const tol = 8 * pxPerScreen();
    const selRoom = selection?.kind === "room" ? project.rooms.find((r) => r.id === selection.id) : null;
    if (selRoom) {
      const idx = selRoom.points.findIndex((v) => dist(v, p) < tol);
      if (idx >= 0) {
        const v = selRoom.points[idx];
        // 같은 위치를 공유하는 다른 방 꼭짓점도 함께 움직여 벽이 벌어지지 않게
        const refs = project.rooms.flatMap((r) =>
          r.points.flatMap((q, i) => (dist(q, v) < 0.5 ? [{ roomId: r.id, idx: i }] : [])),
        );
        drag.current = { kind: "vertex", refs, base: project, moved: false };
        (e.target as Element).setPointerCapture?.(e.pointerId);
        return;
      }
    }
    const selOpening = selection?.kind === "opening" ? project.openings.find((o) => o.id === selection.id) : null;
    if (selOpening) {
      for (const end of ["a", "b"] as const) {
        if (dist(selOpening[end], p) < tol) {
          drag.current = { kind: "openEnd", id: selOpening.id, end, base: project, moved: false };
          (e.target as Element).setPointerCapture?.(e.pointerId);
          return;
        }
      }
    }
    // 설비: 클릭하면 선택, 끌면 이동
    const it = [...(project.items ?? [])].reverse().find((x) => pointInPolygon(p, itemCorners(x, project.mmPerPx)));
    if (it) {
      onSelect({ kind: "item", id: it.id });
      drag.current = { kind: "item", id: it.id, base: project, dx: p.x - it.x, dy: p.y - it.y, moved: false };
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    const o = hitOpening(p);
    if (o) return onSelect({ kind: "opening", id: o.id });
    const inf = project.traced?.infills.find((f) => pointInPolygon(p, f.poly) || projectToSegment(p, f.poly[0], f.poly[1]).d < 6 * pxPerScreen());
    if (inf) return onSelect({ kind: "infill", id: inf.id });
    const r = hitRoom(p);
    if (r) return onSelect({ kind: "room", id: r.id });
    onSelect(null);
    drag.current = { kind: "pan", start: { x: e.clientX, y: e.clientY }, vb };
    setPanning(true);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = toPlan(e);
    const d = drag.current;
    if (d?.kind === "pan") {
      const k = pxPerScreen();
      setVb({ ...d.vb, x: d.vb.x - (e.clientX - d.start.x) * k, y: d.vb.y - (e.clientY - d.start.y) * k });
      return;
    }
    if (d?.kind === "vertex") {
      const others = project.rooms.flatMap((r) =>
        r.points.filter((_, i) => !d.refs.some((x) => x.roomId === r.id && x.idx === i)),
      );
      const tol = 8 * pxPerScreen();
      let q = p;
      if (!e.shiftKey) {
        // 다른 꼭짓점과 수평/수직 정렬
        for (const v of others) {
          if (Math.abs(v.x - q.x) < tol) q = { ...q, x: v.x };
          if (Math.abs(v.y - q.y) < tol) q = { ...q, y: v.y };
        }
      }
      const rooms = d.base.rooms.map((r) => {
        const mine = d.refs.filter((x) => x.roomId === r.id);
        if (!mine.length) return r;
        return { ...r, points: r.points.map((pt, i) => (mine.some((x) => x.idx === i) ? q : pt)) };
      });
      // 드래그 첫 이동에서만 기록 → 드래그 한 번이 실행취소 한 번
      onChange({ ...d.base, rooms }, !d.moved);
      d.moved = true;
      return;
    }
    if (d?.kind === "item") {
      const items = (d.base.items ?? []).map((x) => (x.id === d.id ? { ...x, x: p.x - d.dx, y: p.y - d.dy } : x));
      onChange({ ...d.base, items }, !d.moved);
      d.moved = true;
      return;
    }
    if (d?.kind === "openEnd") {
      const o = d.base.openings.find((x) => x.id === d.id)!;
      const other = d.end === "a" ? o.b : o.a;
      const fixed = d.end === "a" ? o.a : o.b;
      // 벽 방향 유지
      const dx = fixed.x - other.x;
      const dy = fixed.y - other.y;
      const len2 = dx * dx + dy * dy || 1;
      const t = ((p.x - other.x) * dx + (p.y - other.y) * dy) / len2;
      const q = { x: other.x + dx * t, y: other.y + dy * t };
      const openings = d.base.openings.map((x) => (x.id === d.id ? { ...x, [d.end]: q } : x));
      onChange({ ...d.base, openings }, !d.moved);
      d.moved = true;
      return;
    }
    if (tool === "room") setCursor(roomPoint(p));
    else if (tool === "door" || tool === "window" || tool === "open") setCursor(openingPoint(p));
    else if (tool === "scale") setCursor(snapVertex(p) ?? p);
    else setCursor(null);
  };

  const onPointerUp = () => {
    drag.current = null;
    setPanning(false);
  };

  const k = pxPerScreen();
  const mm = (px: number) => Math.round(px * project.mmPerPx);
  const gridStep = 1000 / project.mmPerPx;
  const selectedRoom = selection?.kind === "room" ? project.rooms.find((r) => r.id === selection.id) : undefined;
  const selectedOpening = selection?.kind === "opening" ? project.openings.find((o) => o.id === selection.id) : undefined;

  const cursorStyle = panning ? "grabbing" : tool === "select" ? "default" : "crosshair";

  return (
    <svg
      ref={svgRef}
      className="h-full w-full touch-none select-none bg-neutral-100"
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      style={{ cursor: cursorStyle }}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setCursor(null)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <defs>
        <pattern id="grid" width={gridStep} height={gridStep} patternUnits="userSpaceOnUse">
          <path d={`M ${gridStep} 0 L 0 0 0 ${gridStep}`} fill="none" stroke="#d4d4d4" strokeWidth={k} />
        </pattern>
      </defs>
      <rect x={vb.x - vb.w} y={vb.y - vb.h} width={vb.w * 3} height={vb.h * 3} fill="url(#grid)" />
      {project.image && (
        <image href={project.image.dataUrl} x={0} y={0} width={project.image.width} height={project.image.height} opacity={0.75} />
      )}

      {project.rooms.map((r) => {
        const c = centroid(r.points);
        const sel = r.id === selectedRoom?.id;
        return (
          <g key={r.id}>
            <polygon
              points={r.points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill={getMaterial(r.floorMat).color}
              fillOpacity={sel ? 0.55 : 0.35}
              stroke={sel ? "#2563eb" : "#404040"}
              strokeWidth={(sel ? 2.5 : 1.5) * k}
            />
            <text x={c.x} y={c.y} textAnchor="middle" fontSize={13 * k} fill="#171717" fontWeight={600}>
              {r.name}
            </text>
            <text x={c.x} y={c.y + 15 * k} textAnchor="middle" fontSize={11 * k} fill="#525252">
              {roomAreaM2(r, project).toFixed(1)}㎡
            </text>
          </g>
        );
      })}

      {selectedRoom &&
        selectedRoom.points.map((p, i) => {
          const q = selectedRoom.points[(i + 1) % selectedRoom.points.length];
          return (
            <text
              key={`len-${i}`}
              x={(p.x + q.x) / 2}
              y={(p.y + q.y) / 2 - 4 * k}
              textAnchor="middle"
              fontSize={10 * k}
              fill="#1d4ed8"
              stroke="white"
              strokeWidth={3 * k}
              paintOrder="stroke"
            >
              {mm(dist(p, q))}
            </text>
          );
        })}

      {/* 평면도에서 딴 벽 구조 */}
      {project.traced && (
        <g pointerEvents="none">
          {project.traced.walls.map((w, i) => (
            <path
              key={i}
              d={[w.outer, ...w.holes].map((r) => `M${r.map((p) => `${p.x},${p.y}`).join("L")}Z`).join("")}
              fill="#27272a"
              fillOpacity={0.8}
              fillRule="evenodd"
            />
          ))}
          {project.traced.infills.map((f) => (
            <polygon
              key={f.id}
              points={f.poly.map((p) => `${p.x},${p.y}`).join(" ")}
              fill={INFILL_COLOR[f.kind]}
              fillOpacity={0.9}
              stroke={selection?.id === f.id ? "#111" : f.fit ? "white" : "none"}
              strokeDasharray={selection?.id !== f.id && f.fit ? `${3 * k} ${2 * k}` : undefined}
              strokeWidth={(f.fit ? 1.5 : 2) * k}
            />
          ))}
        </g>
      )}

      {/* 주방·욕실 설비 */}
      {(project.items ?? []).map((it) => {
        const cs = itemCorners(it, project.mmPerPx);
        const sel = selection?.kind === "item" && selection.id === it.id;
        const front = [cs[2], cs[3]];
        return (
          <g key={it.id} pointerEvents="none">
            <polygon
              points={cs.map((p) => `${p.x},${p.y}`).join(" ")}
              fill={ITEM_SPECS[it.type].group === "주방" ? "#fde68a" : "#bae6fd"}
              fillOpacity={0.85}
              stroke={sel ? "#111" : "#525252"}
              strokeWidth={(sel ? 2.5 : 1) * k}
            />
            <line x1={front[0].x} y1={front[0].y} x2={front[1].x} y2={front[1].y} stroke="#111" strokeWidth={2 * k} />
            <text x={it.x} y={it.y + 4 * k} textAnchor="middle" fontSize={10 * k} fill="#171717">
              {ITEM_SPECS[it.type].label.split(" ")[0]}
            </text>
          </g>
        );
      })}

      {/* 문짝·샷시가 달린 자리 표시 */}
      {project.openings
        .filter((o) => o.fit)
        .map((o) => (
          <line key={`fit-${o.id}`} x1={o.a.x} y1={o.a.y} x2={o.b.x} y2={o.b.y} stroke="white" strokeWidth={1.5 * k} strokeDasharray={`${3 * k} ${2 * k}`} pointerEvents="none" />
        ))}

      {project.openings.map((o) => (
        <line
          key={o.id}
          x1={o.a.x}
          y1={o.a.y}
          x2={o.b.x}
          y2={o.b.y}
          stroke={OPENING_COLOR[o.kind]}
          strokeWidth={(o.id === selectedOpening?.id ? 7 : 5) * k}
          strokeDasharray={o.kind === "open" ? `${6 * k} ${4 * k}` : undefined}
          strokeLinecap="butt"
        />
      ))}

      {selectedRoom?.points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={5 * k} fill="white" stroke="#2563eb" strokeWidth={2 * k} />
      ))}
      {selectedOpening &&
        [selectedOpening.a, selectedOpening.b].map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={5 * k} fill="white" stroke={OPENING_COLOR[selectedOpening.kind]} strokeWidth={2 * k} />
        ))}

      {/* 그리는 중 미리보기 */}
      {draft.length > 0 && (
        <g pointerEvents="none">
          <polyline
            points={[...draft, ...(cursor ? [cursor] : [])].map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke={tool === "room" ? "#2563eb" : tool === "scale" ? "#dc2626" : OPENING_COLOR[tool as OpeningKind]}
            strokeWidth={(tool === "room" || tool === "scale" ? 2 : 5) * k}
          />
          {draft.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={4 * k} fill="#2563eb" />
          ))}
          {cursor && (
            <text
              x={(draft[draft.length - 1].x + cursor.x) / 2}
              y={(draft[draft.length - 1].y + cursor.y) / 2 - 6 * k}
              textAnchor="middle"
              fontSize={12 * k}
              fill="#1d4ed8"
              stroke="white"
              strokeWidth={3 * k}
              paintOrder="stroke"
            >
              {tool === "scale" ? `${Math.round(dist(draft[draft.length - 1], cursor))}px` : `${mm(dist(draft[draft.length - 1], cursor))}mm`}
            </text>
          )}
        </g>
      )}
      {cursor && tool !== "select" && (
        <circle cx={cursor.x} cy={cursor.y} r={4 * k} fill="none" stroke="#dc2626" strokeWidth={1.5 * k} pointerEvents="none" />
      )}
    </svg>
  );
}
