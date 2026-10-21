import { PartBuilder, type RoomMesh, type V3 } from "./build";
import { dist, pointInPolygon, polygonArea, projectToSegment, uid } from "./geometry";
import { paint } from "./materials";
import type { Fit, FitType, Item, ItemType, Project, Pt, Room } from "./types";
import { INFILL_HEIGHTS } from "./types";

// 주방·욕실 설비와 문·창호(문짝+문틀, 현관문, 샷시)를 상자 조합으로 만든다.
// 스케치업으로 넘어가면 하나하나가 따로 그룹이라 디자이너가 실제 모델로 바꿔 끼우기 쉽다.

// ---------- 카탈로그 ----------

export type ItemSpec = {
  type: ItemType;
  label: string;
  group: "주방" | "욕실";
  w: number;
  d: number;
  /** 사용자가 색을 바꿀 수 있는지 (싱크대 문짝, 세면대 하부장 등) */
  colorable: boolean;
  color: string;
};

export const ITEM_SPECS: Record<ItemType, ItemSpec> = {
  sink: { type: "sink", label: "싱크대 (상부장 포함)", group: "주방", w: 2400, d: 600, colorable: true, color: "#f4f4f1" },
  fridge: { type: "fridge", label: "냉장고 자리", group: "주방", w: 910, d: 920, colorable: true, color: "#c8c8c4" },
  toilet: { type: "toilet", label: "양변기", group: "욕실", w: 400, d: 700, colorable: false, color: "#f7f7f5" },
  basin: { type: "basin", label: "세면대 + 하부장", group: "욕실", w: 600, d: 460, colorable: true, color: "#f4f4f1" },
  bathtub: { type: "bathtub", label: "욕조", group: "욕실", w: 1500, d: 750, colorable: false, color: "#f7f7f5" },
  shower: { type: "shower", label: "샤워부스", group: "욕실", w: 900, d: 900, colorable: false, color: "#a9adb1" },
};

export const FIT_DEFAULTS: Record<FitType, Fit> = {
  door: { type: "door", frame: "#f4f4f1", leaf: "#f4f4f1" },
  entry: { type: "entry", frame: "#4a4c50", leaf: "#4a4c50" },
  sash: { type: "sash", frame: "#f4f4f1", leaf: "#f4f4f1" },
};

// ---------- 상자 ----------

/**
 * 평면(mm, y 아래쪽) 기준 중심·회전으로 놓인 상자. 지역 좌표 x: 폭 방향, y: 앞쪽(+), z: 높이.
 * 모델 좌표(Y = -평면 y)로 바꿔 넣는다.
 */
export function box(
  pb: PartBuilder,
  mat: string,
  c: Pt,
  rotDeg: number,
  [x0, x1]: [number, number],
  [y0, y1]: [number, number],
  [z0, z1]: [number, number],
) {
  if (x1 - x0 < 0.5 || y1 - y0 < 0.5 || z1 - z0 < 0.5) return;
  const r = (rotDeg * Math.PI) / 180;
  const u = { x: Math.cos(r), y: Math.sin(r) };
  const v = { x: -Math.sin(r), y: Math.cos(r) };
  const P = (lx: number, ly: number, z: number): V3 => {
    const px = c.x + u.x * lx + v.x * ly;
    const py = c.y + u.y * lx + v.y * ly;
    return [px, -py, z];
  };
  const um: V3 = [u.x, -u.y, 0];
  const vm: V3 = [v.x, -v.y, 0];
  const neg = (n: V3): V3 => [-n[0], -n[1], -n[2]];
  const uv: [number, number][] = [[0, 0], [0, 0], [0, 0], [0, 0]];
  pb.quad(mat, [P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)], uv, um);
  pb.quad(mat, [P(x0, y0, z0), P(x0, y1, z0), P(x0, y1, z1), P(x0, y0, z1)], uv, neg(um));
  pb.quad(mat, [P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], uv, vm);
  pb.quad(mat, [P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)], uv, neg(vm));
  pb.quad(mat, [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], uv, [0, 0, 1]);
  if (z0 > 0) pb.quad(mat, [P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0)], uv, [0, 0, -1]);
}

// ---------- 설비 ----------

function buildItem(item: Item, project: Project): RoomMesh {
  const pb = new PartBuilder();
  const c = { x: item.x * project.mmPerPx, y: item.y * project.mmPerPx };
  const B = (mat: string, x: [number, number], y: [number, number], z: [number, number]) => box(pb, mat, c, item.rot, x, y, z);
  const w = item.w / 2;
  const d = item.d / 2;
  const col = paint(item.color);
  switch (item.type) {
    case "sink": {
      B(paint("#3a3a3a"), [-w, w], [-d, d - 60], [0, 100]); // 걸레받이
      B(col, [-w, w], [-d, d], [100, 850]); // 하부장
      B("stone", [-w, w], [-d, d + 20], [850, 880]); // 상판
      const sx = Math.min(w - 450, 300);
      B("steel", [sx - 400, sx + 400], [-d + 80, d - 80], [880, 884]); // 개수대
      B("steel", [sx - 20, sx + 20], [-d + 40, -d + 80], [884, 1150]); // 수전
      B(col, [-w, w], [-d, -d + 350], [1450, 2150]); // 상부장
      break;
    }
    case "fridge":
      B(col, [-w, w], [-d, d], [0, 1850]);
      B(paint("#7d8186"), [-w + 20, w - 20], [d, d + 4], [1000, 1010]); // 문 사이 선
      break;
    case "toilet":
      B("porcelain", [-w, w], [-d, -d + 180], [380, 780]); // 물탱크
      B("porcelain", [-w + 30, w - 30], [-d + 150, d], [0, 380]); // 몸체
      B(paint("#ececea"), [-w + 20, w - 20], [-d + 170, d + 10], [380, 405]); // 시트
      break;
    case "basin":
      B(col, [-w, w], [-d, d], [450, 800]); // 하부장 (벽걸이)
      B("porcelain", [-w - 10, w + 10], [-d, d + 10], [800, 840]); // 세면대
      B("steel", [-20, 20], [-d + 30, -d + 70], [840, 1000]); // 수전
      B("mirror", [-w, w], [-d, -d + 15], [1100, 1800]); // 거울
      break;
    case "bathtub":
      B("porcelain", [-w, w], [-d, d], [0, 550]);
      B(paint("#dfe9ee"), [-w + 70, w - 70], [-d + 70, d - 70], [550, 553]); // 안쪽 표시
      break;
    case "shower":
      B(paint("#d9dcdc"), [-w, w], [-d, d], [0, 60]); // 샤워 받침
      B("glass", [-w, w], [d - 10, d], [60, 2000]); // 앞 유리
      B("glass", [w - 10, w], [-d, d], [60, 2000]); // 옆 유리
      B("steel", [-w, w], [d - 30, d], [2000, 2030]);
      break;
  }
  return { roomId: `item-${item.id}`, name: ITEM_SPECS[item.type].label.split(" ")[0], parts: [...pb.parts.values()] };
}

// ---------- 문·창 자리 ----------

/** 문·창 자리 하나: 평면(mm) 중심, 벽 방향 각도, 폭·벽두께·하단·상단 */
export type Slot = {
  id: string;
  source: "opening" | "infill";
  center: Pt;
  rot: number;
  width: number;
  depth: number;
  sill: number;
  head: number;
  isWindow: boolean;
  fit?: Fit;
};

export function slotsOf(project: Project): Slot[] {
  const s = project.mmPerPx;
  const H = project.wallHeight;
  const slots: Slot[] = [];
  for (const o of project.openings) {
    if (o.kind === "open") continue;
    const a = { x: o.a.x * s, y: o.a.y * s };
    const b = { x: o.b.x * s, y: o.b.y * s };
    slots.push({
      id: o.id,
      source: "opening",
      center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      rot: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
      width: dist(a, b),
      depth: project.wallThickness,
      sill: Math.min(o.sill, H),
      head: Math.min(o.head, H),
      isWindow: o.kind === "window",
      fit: o.fit,
    });
  }
  for (const f of project.traced?.infills ?? []) {
    const pts = f.poly.map((p) => ({ x: p.x * s, y: p.y * s }));
    // 가장 긴 변을 벽 방향으로 보고 그 축으로 감싼 사각형
    let best = 0;
    let dir = { x: 1, y: 0 };
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      const l = dist(p, q);
      if (l > best) {
        best = l;
        dir = { x: (q.x - p.x) / l, y: (q.y - p.y) / l };
      }
    }
    const nrm = { x: -dir.y, y: dir.x };
    const us = pts.map((p) => p.x * dir.x + p.y * dir.y);
    const vs = pts.map((p) => p.x * nrm.x + p.y * nrm.y);
    const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
    const cu = (u0 + u1) / 2;
    const cv = (v0 + v1) / 2;
    const head = Math.min(INFILL_HEIGHTS.head, H);
    slots.push({
      id: f.id,
      source: "infill",
      center: { x: dir.x * cu + nrm.x * cv, y: dir.y * cu + nrm.y * cv },
      rot: (Math.atan2(dir.y, dir.x) * 180) / Math.PI,
      width: u1 - u0,
      depth: v1 - v0,
      sill: f.kind === "window" ? Math.min(INFILL_HEIGHTS.sill, head) : 0,
      head,
      isWindow: f.kind !== "door",
      fit: f.fit,
    });
  }
  return slots;
}

function buildFit(slot: Slot, fit: Fit): RoomMesh {
  const pb = new PartBuilder();
  const B = (mat: string, x: [number, number], y: [number, number], z: [number, number]) => box(pb, mat, slot.center, slot.rot, x, y, z);
  const w = slot.width / 2;
  const t = Math.max(60, slot.depth) / 2;
  const frame = paint(fit.frame);
  const leaf = paint(fit.leaf);
  const { sill, head } = slot;
  if (fit.type === "door" || fit.type === "entry") {
    const f = fit.type === "entry" ? 60 : 40; // 문틀 두께
    const lt = fit.type === "entry" ? 30 : 20; // 문짝 두께의 반
    B(frame, [-w, -w + f], [-t, t], [0, head]);
    B(frame, [w - f, w], [-t, t], [0, head]);
    B(frame, [-w, w], [-t, t], [head - f, head]);
    if (fit.type === "entry") B(paint("#8b8b88"), [-w + f, w - f], [-t, t], [0, 20]); // 현관 문턱
    const z0 = fit.type === "entry" ? 22 : 10;
    B(leaf, [-w + f + 3, w - f - 3], [-lt, lt], [z0, head - f - 3]);
    // 손잡이 (양쪽)
    const hx = w - f - 70;
    for (const side of [1, -1]) {
      const y: [number, number] = side > 0 ? [lt, lt + 50] : [-lt - 50, -lt];
      B("steel", [hx - 130, hx], y, [990, 1010]);
    }
  } else {
    const f = 55; // 샷시 프레임
    const ft = Math.min(t, 100);
    B(frame, [-w, w], [-ft, ft], [sill, sill + f]);
    B(frame, [-w, w], [-ft, ft], [head - f, head]);
    B(frame, [-w, -w + f], [-ft, ft], [sill, head]);
    B(frame, [w - f, w], [-ft, ft], [sill, head]);
    // 미닫이 두 짝 (폭 900 이하면 한 짝): 서로 앞뒤로 엇갈림
    const inner = w - f;
    const panes = slot.width > 900 ? 2 : 1;
    const pw = (inner * 2) / panes;
    for (let i = 0; i < panes; i++) {
      const x0 = -inner + i * pw - (i ? 25 : 0);
      const x1 = x0 + pw + (panes > 1 ? 25 : 0);
      const off = panes > 1 ? (i ? 22 : -22) : 0;
      const y: [number, number] = [off - 15, off + 15];
      const s = 40; // 창짝 살 두께
      B(frame, [x0, x1], y, [sill + f, sill + f + s]);
      B(frame, [x0, x1], y, [head - f - s, head - f]);
      B(frame, [x0, x0 + s], y, [sill + f, head - f]);
      B(frame, [x1 - s, x1], y, [sill + f, head - f]);
      B("glass", [x0 + s, x1 - s], [off - 3, off + 3], [sill + f + s, head - f - s]);
    }
  }
  return { roomId: `fit-${slot.id}`, name: fit.type === "sash" ? "샷시" : fit.type === "entry" ? "현관문" : "문", parts: [...pb.parts.values()] };
}

export function buildFixtures(project: Project): RoomMesh[] {
  const out: RoomMesh[] = [];
  for (const slot of slotsOf(project)) if (slot.fit) out.push(buildFit(slot, slot.fit));
  for (const item of project.items ?? []) out.push(buildItem(item, project));
  return out.filter((m) => m.parts.length);
}

// ---------- 배치 ----------

/** 설비 네 귀퉁이 (이미지 px) — 2D 표시용 */
export function itemCorners(item: Item, mmPerPx: number): Pt[] {
  const r = (item.rot * Math.PI) / 180;
  const u = { x: Math.cos(r), y: Math.sin(r) };
  const v = { x: -Math.sin(r), y: Math.cos(r) };
  const w = item.w / 2 / mmPerPx;
  const d = item.d / 2 / mmPerPx;
  return [
    [-w, -d],
    [w, -d],
    [w, d],
    [-w, d],
  ].map(([a, b]) => ({ x: item.x + u.x * a + v.x * b, y: item.y + u.y * a + v.y * b }));
}

type Wall = { a: Pt; b: Pt; inset: number; room: Room };

/** 방 벽선들 (이미지 px). 벽 안쪽 면까지의 거리(px)를 같이 */
function wallsOf(project: Project): Wall[] {
  const out: Wall[] = [];
  for (const room of project.rooms) {
    const inset = room.floorOnly ? 0 : project.wallThickness / 2 / project.mmPerPx;
    for (let i = 0; i < room.points.length; i++) out.push({ a: room.points[i], b: room.points[(i + 1) % room.points.length], inset, room });
  }
  return out;
}

/** 클릭한 곳에서 가장 가까운 벽에 등을 대고 놓기 */
export function placeItem(project: Project, type: ItemType, p: Pt): Item {
  const spec = ITEM_SPECS[type];
  const item: Item = { id: uid(), type, x: p.x, y: p.y, rot: 0, w: spec.w, d: spec.d, color: spec.color };
  const maxDist = 1500 / project.mmPerPx;
  let best: { wall: Wall; d: number; pt: Pt } | null = null;
  for (const wall of wallsOf(project)) {
    const hit = projectToSegment(p, wall.a, wall.b);
    if (hit.d < maxDist && (!best || hit.d < best.d)) best = { wall, d: hit.d, pt: hit.pt };
  }
  if (!best) return item;
  return againstWall(item, best.wall, best.pt, p, project.mmPerPx);
}

function againstWall(item: Item, wall: Wall, onWall: Pt, toward: Pt, mmPerPx: number): Item {
  const L = dist(wall.a, wall.b) || 1;
  const e = { x: (wall.b.x - wall.a.x) / L, y: (wall.b.y - wall.a.y) / L };
  let n = { x: -e.y, y: e.x };
  if ((toward.x - onWall.x) * n.x + (toward.y - onWall.y) * n.y < 0) n = { x: -n.x, y: -n.y };
  // 지역 +y(앞) = n 이 되도록: u = (n.y, -n.x)
  const rot = (Math.atan2(-n.x, n.y) * 180) / Math.PI;
  const half = item.w / 2 / mmPerPx;
  // 벽 끝을 넘어가지 않게 벽 위 위치를 제한
  const s = Math.max(half, Math.min(L - half, (onWall.x - wall.a.x) * e.x + (onWall.y - wall.a.y) * e.y));
  const off = wall.inset + item.d / 2 / mmPerPx + 1 / mmPerPx;
  return { ...item, rot, x: wall.a.x + e.x * s + n.x * off, y: wall.a.y + e.y * s + n.y * off };
}

/** 주방·욕실로 지정된 방에 기본 설비를 놓는다 (이미 설비가 있는 방은 건너뜀) */
export function autoFixtures(project: Project): Item[] {
  const items = [...(project.items ?? [])];
  const has = (room: Room) => items.some((it) => pointInPolygon({ x: it.x, y: it.y }, room.points));
  const s = project.mmPerPx;
  for (const room of project.rooms) {
    if ((room.type !== "kitchen" && room.type !== "bath") || has(room) || room.points.length < 3) continue;
    const walls = wallsOf({ ...project, rooms: [room] }).sort((p, q) => dist(q.a, q.b) - dist(p.a, p.b));
    const inside = (w: Wall) => {
      const mid = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
      const L = dist(w.a, w.b) || 1;
      const n = { x: -(w.b.y - w.a.y) / L, y: (w.b.x - w.a.x) / L };
      const probe = { x: mid.x + n.x * 0.01, y: mid.y + n.y * 0.01 };
      return pointInPolygon(probe, room.points) ? { x: mid.x + n.x * 100, y: mid.y + n.y * 100 } : { x: mid.x - n.x * 100, y: mid.y - n.y * 100 };
    };
    const place = (type: ItemType, wall: Wall, at: number, w?: number) => {
      const spec = ITEM_SPECS[type];
      const L = dist(wall.a, wall.b);
      const pt = { x: wall.a.x + ((wall.b.x - wall.a.x) / L) * at, y: wall.a.y + ((wall.b.y - wall.a.y) / L) * at };
      const base: Item = { id: uid(), type, x: pt.x, y: pt.y, rot: 0, w: w ?? spec.w, d: spec.d, color: spec.color };
      items.push(againstWall(base, wall, pt, inside(wall), s));
    };
    const [long, second] = walls;
    const Lmm = dist(long.a, long.b) * s;
    if (room.type === "kitchen") {
      const sinkW = Math.max(1200, Math.min(3600, Math.floor((Lmm - 1100) / 100) * 100));
      place("sink", long, (sinkW / 2 + 100) / s, sinkW);
      if (Lmm - sinkW > 1000) place("fridge", long, (sinkW + 200 + 455) / s);
    } else {
      const areaM2 = (polygonArea(room.points) * s * s) / 1e6;
      place("basin", long, Math.min(700, Lmm / 2) / s);
      place("toilet", long, Math.min(Lmm - 400, 1500) / s);
      if (areaM2 >= 4 && second) place("bathtub", second, (dist(second.a, second.b) * s) / 2 / s, Math.min(1500, dist(second.a, second.b) * s - 100));
      else if (second) place("shower", second, Math.min(500, (dist(second.a, second.b) * s) / 2) / s);
    }
  }
  return items;
}
