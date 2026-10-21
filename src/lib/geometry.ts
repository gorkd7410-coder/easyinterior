import type { Pt } from "./types";

export const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

export function signedArea(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

export const polygonArea = (pts: Pt[]) => Math.abs(signedArea(pts));

export function centroid(pts: Pt[]): Pt {
  const a = signedArea(pts);
  if (Math.abs(a) < 1e-9) {
    const n = pts.length || 1;
    return {
      x: pts.reduce((s, p) => s + p.x, 0) / n,
      y: pts.reduce((s, p) => s + p.y, 0) / n,
    };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function pointInPolygon(p: Pt, pts: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** 선분 ab 위에서 p에 가장 가까운 점과 파라미터 t(0~1) */
export function projectToSegment(p: Pt, a: Pt, b: Pt): { pt: Pt; t: number; d: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const pt = { x: a.x + dx * t, y: a.y + dy * t };
  return { pt, t, d: dist(p, pt) };
}

/** 직전 점 기준으로 수평/수직에 가까우면 맞춰준다 (한국 아파트 평면은 대부분 직교) */
export function orthoSnap(p: Pt, prev: Pt, toleranceDeg = 6): Pt {
  const dx = p.x - prev.x;
  const dy = p.y - prev.y;
  const ang = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI;
  if (ang < toleranceDeg) return { x: p.x, y: prev.y };
  if (ang > 90 - toleranceDeg) return { x: prev.x, y: p.y };
  return p;
}

/**
 * 다각형을 안쪽으로 w만큼 띄운 꼭짓점들 (각 모서리 마이터 처리).
 * 반환 배열 i번째 = 원래 꼭짓점 i에 대응.
 */
export function insetPolygon(pts: Pt[], w: number): { inset: Pt[]; normals: Pt[] } {
  const n = pts.length;
  const ccw = signedArea(pts) > 0;
  const dirs: Pt[] = [];
  const normals: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const len = dist(a, b) || 1;
    const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    dirs.push(d);
    normals.push(ccw ? { x: -d.y, y: d.x } : { x: d.y, y: -d.x });
  }
  const inset: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n;
    const p = pts[i];
    const p1 = { x: p.x + normals[prev].x * w, y: p.y + normals[prev].y * w };
    const p2 = { x: p.x + normals[i].x * w, y: p.y + normals[i].y * w };
    const d1 = dirs[prev];
    const d2 = dirs[i];
    const cross = d1.x * d2.y - d1.y * d2.x;
    if (Math.abs(cross) < 1e-6) {
      inset.push(p2);
      continue;
    }
    const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / cross;
    let q = { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
    // 아주 뾰족한 모서리에서 마이터가 튀지 않도록 제한
    const miter = dist(q, p);
    if (miter > Math.abs(w) * 4) {
      const s = (Math.abs(w) * 4) / miter;
      q = { x: p.x + (q.x - p.x) * s, y: p.y + (q.y - p.y) * s };
    }
    inset.push(q);
  }
  return { inset, normals };
}

export const uid = () => Math.random().toString(36).slice(2, 10);
