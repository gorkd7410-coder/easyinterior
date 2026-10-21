import { insetPolygon, polygonArea } from "./geometry";
import type { Project, Room } from "./types";

/** 안목치수(벽 안쪽) 기준 면적 ㎡ */
export function roomAreaM2(room: Room, p: Pt2Scale): number {
  if (room.points.length < 3) return 0;
  if (room.floorOnly) return (polygonArea(room.points) * p.mmPerPx * p.mmPerPx) / 1e6;
  const inset = insetPolygon(room.points, p.wallThickness / 2 / p.mmPerPx).inset;
  return (polygonArea(inset) * p.mmPerPx * p.mmPerPx) / 1e6;
}

type Pt2Scale = Pick<Project, "mmPerPx" | "wallThickness">;

/** 발코니를 뺀 방 면적 합이 전용면적이 되도록 축척을 역산 */
export function fitScaleToArea(project: Project, targetM2: number): number {
  const rooms = project.rooms.filter((r) => r.type !== "balcony");
  if (rooms.length === 0 || targetM2 <= 0) return project.mmPerPx;
  let s = project.mmPerPx;
  for (let i = 0; i < 6; i++) {
    const cur = rooms.reduce((acc, r) => acc + roomAreaM2(r, { mmPerPx: s, wallThickness: project.wallThickness }), 0);
    if (cur <= 0) break;
    s *= Math.sqrt(targetM2 / cur);
  }
  return s;
}

export function totalAreaM2(project: Project): number {
  return project.rooms
    .filter((r) => r.type !== "balcony")
    .reduce((acc, r) => acc + roomAreaM2(r, project), 0);
}

export const STORAGE_KEY = "interior-mvp:project";

export function loadSaved(): Project | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Project;
    return p && p.version === 1 ? p : null;
  } catch {
    return null;
  }
}

export function save(project: Project) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  } catch {
    // 이미지가 커서 저장 한도를 넘는 경우 등 — 자동저장은 편의 기능이라 무시
  }
}
