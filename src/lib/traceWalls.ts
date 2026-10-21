import {
  borderLabels,
  cleanup,
  dilate,
  erode,
  estimateWallThickness,
  footprintMask,
  label,
  orthogonalize,
  otsu,
  removeSmallBlobs,
  resizeLum,
  simplifyClosed,
  traceOuter,
  type Gray,
} from "./detect";
import { pointInPolygon, polygonArea, signedArea } from "./geometry";
import type { Pt } from "./types";

// 평면도 이미지의 검은 벽을 그대로 따서 3D로 세우기 위한 벽 윤곽 추출.
// 방을 찾는 방식(detect.ts)과 달리 벽 모양 자체를 쓰므로 대각선 벽·불규칙한 벽도 그대로 살아난다.
//  1) 아주 어두운 픽셀 = 벽. 얇은 선(창 표시·문 호)과 글자 덩어리는 지운다
//  2) 벽 픽셀 경계를 모두 따라 외곽선/구멍 고리를 얻고 단순화 (거의 수평·수직인 변만 축에 맞춤)
//  3) 건물 윤곽 가장자리의 벽 틈 = 창, 벽을 문 폭만큼 닫았을 때 메워지는 안쪽 틈 = 문
//     → 문 위 / 창 위아래 벽을 채울 자리
//  4) 둘레 대부분이 벽인 빈 공간 = 방 바닥, 건물 윤곽 = 바닥 슬래브

export type WallShape = { outer: Pt[]; holes: Pt[][] };
export type Infill = {
  poly: Pt[];
  kind: "door" | "window";
  /** 바닥까지 내려오는 창 (거실 발코니 창 등) */
  floorLevel: boolean;
};

export type TracedPlan = {
  walls: WallShape[];
  infills: Infill[];
  regions: Pt[][];
  slab: Pt[] | null;
  /** 추정 벽 두께 (원본 이미지 px) */
  wallPx: number;
  /** 방문 폭(약 900mm) 기준 축척 추정치 */
  mmPerPxGuess: number;
};

const MAX_DIM = 1600;

export function traceWalls(img: Gray, opts: { gapStrength: number }): TracedPlan {
  const f = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
  const W = Math.max(1, Math.round(img.width * f));
  const H = Math.max(1, Math.round(img.height * f));
  const lum = resizeLum(img, W, H);

  // 네이버·호갱노노 평면도의 벽은 거의 검정. 바닥색(나무·타일)보다 확실히 어두운 것만 벽으로
  const thr = Math.max(40, Math.min(110, Math.round(otsu(lum) * 0.55)));
  const dark = new Uint8Array(W * H);
  for (let i = 0; i < lum.length; i++) dark[i] = lum[i] < thr ? 1 : 0;
  const t = estimateWallThickness(dark, W, H);
  const k = Math.max(1, Math.floor(t * 0.25));
  const wall = dilate(erode(dark, W, H, k), W, H, k);
  removeSmallBlobs(wall, W, H, 2.5 * t);

  // 벽 윤곽
  const eps = Math.max(0.8, t * 0.2);
  const loops = traceAllLoops(wall, W, H)
    .map((l) => tidy(l, eps))
    .filter((l) => l.length >= 3 && Math.abs(signedArea(l)) >= t * t);
  const outers = loops.filter((l) => signedArea(l) > 0);
  const holes = loops.filter((l) => signedArea(l) < 0);
  const walls: WallShape[] = outers.map((outer) => ({ outer, holes: [] }));
  for (const h of holes) {
    const owner = walls
      .filter((w) => pointInPolygon(h[0], w.outer) || pointInPolygon(centerOf(h), w.outer))
      .sort((a, b) => polygonArea(a.outer) - polygonArea(b.outer))[0];
    owner?.holes.push(h);
  }

  // 건물 윤곽: 벽을 크게 닫아 넓은 거실 창까지 메운 뒤 바깥과 이어지지 않는 부분
  const foot = footprintMask(wall, W, H, Math.round(20 * t));
  const footLab = label(foot, W, H);
  let slab: Pt[] | null = null;
  let best = 0;
  for (let id = 1; id <= footLab.count; id++) {
    const loop = traceOuter(footLab.map, W, H, id);
    if (loop && polygonArea(loop) > best) {
      best = polygonArea(loop);
      slab = loop;
    }
  }
  slab = slab ? tidy(slab, eps) : null;

  // 창 자리: 건물 윤곽(외벽 바깥면)을 따라가며 벽이 비어 있는 구간. 넓은 거실 창도 그대로 잡힌다
  const isWall = (x: number, y: number) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    return xi >= 0 && yi >= 0 && xi < W && yi < H && wall[yi * W + xi] === 1;
  };
  const infills: Infill[] = [];
  const winMask = new Uint8Array(W * H);
  if (slab) {
    for (const w of windowGaps(slab, isWall, t)) {
      infills.push({ poly: w.poly, kind: "window", floorLevel: w.length >= 11 * t });
      fillPolygon(winMask, W, H, w.poly);
    }
  }

  // 문 자리: 벽을 문 폭만큼 닫았을 때 새로 메워지는 안쪽 틈 (외벽 쪽은 위에서 창으로 처리)
  // 네이버식 평면도는 벽을 얇게 그려서 문 폭이 벽 두께의 7~8배쯤 된다
  const rc = Math.max(2, Math.round(4 * t * opts.gapStrength));
  const closed = closeMask(wall, W, H, rc);
  const outside = new Uint8Array(W * H);
  for (let i = 0; i < outside.length; i++) outside[i] = foot[i] ? 0 : 1;
  const exteriorBand = dilate(outside, W, H, Math.max(2, Math.round(1.2 * t)));
  const doorMask = new Uint8Array(W * H);
  for (let i = 0; i < doorMask.length; i++) doorMask[i] = closed[i] && !wall[i] && foot[i] && !exteriorBand[i] ? 1 : 0;
  const doorLab = label(doorMask, W, H);
  const doorLengths: number[] = [];
  const stats = componentStats(doorLab.map, doorLab.count, W);
  for (let id = 1; id <= doorLab.count; id++) {
    const st = stats[id];
    const long = Math.max(st.w, st.h);
    // 벽 두께 정도로 얇고 일정 길이 이상인 틈만 (좁은 구석을 메운 덩어리는 제외)
    if (long < 1.5 * t || st.area / long > 1.8 * t) continue;
    const loop = traceOuter(doorLab.map, W, H, id);
    if (!loop) continue;
    const poly = tidy(loop, eps);
    if (poly.length >= 3) {
      infills.push({ poly, kind: "door", floorLevel: false });
      doorLengths.push(long);
    }
  }

  // 방 바닥: 문틈을 닫은 벽과 창 띠로 둘러싸인 빈 공간 중, 둘레 대부분이 벽인 것
  const blocked = new Uint8Array(W * H);
  for (let i = 0; i < blocked.length; i++) blocked[i] = closed[i] || winMask[i] || !foot[i] ? 1 : 0;
  const roomMask = new Uint8Array(W * H);
  for (let i = 0; i < roomMask.length; i++) roomMask[i] = blocked[i] ? 0 : 1;
  const roomLab = label(roomMask, W, H);
  const border = borderLabels(roomLab, W, H);
  const wallTouch = new Float64Array(roomLab.count + 1);
  const edgeCount = new Float64Array(roomLab.count + 1);
  for (let i = 0; i < roomLab.map.length; i++) {
    const l = roomLab.map[i];
    if (!l) continue;
    const x = i % W;
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
      if (j < 0 || j >= roomLab.map.length || roomLab.map[j] === l) continue;
      edgeCount[l]++;
      if (closed[j]) wallTouch[l]++;
    }
  }
  const regions: Pt[][] = [];
  for (let id = 1; id <= roomLab.count; id++) {
    if (border.has(id) || wallTouch[id] < 0.5 * edgeCount[id]) continue;
    const loop = traceOuter(roomLab.map, W, H, id);
    if (!loop || polygonArea(loop) < (4 * t) ** 2) continue;
    const poly = tidy(loop, eps);
    if (poly.length >= 3) regions.push(poly);
  }

  const S = (p: Pt[]) => p.map((q) => ({ x: q.x / f, y: q.y / f }));
  const wallPx = t / f;
  // 축척 추정: 방문 폭(문틀 포함 약 900mm)의 중앙값. 문이 적으면 벽 두께(약 120mm)로
  doorLengths.sort((a, b) => a - b);
  const doorPx = doorLengths.length >= 3 ? doorLengths[Math.floor(doorLengths.length / 2)] / f : 0;
  const mmPerPxGuess = doorPx ? 900 / doorPx : 120 / wallPx;
  return {
    walls: walls.map((w) => ({ outer: S(w.outer), holes: w.holes.map(S) })),
    infills: infills.map((i) => ({ ...i, poly: S(i.poly) })),
    regions: regions.map(S),
    slab: slab ? S(slab) : null,
    wallPx,
    mmPerPxGuess,
  };
}

/** 단순화 + 거의 수평/수직인 변만 축에 맞춤 (대각선 벽은 그대로) */
function tidy(loop: Pt[], eps: number): Pt[] {
  return cleanup(orthogonalize(simplifyClosed(loop, eps), 6));
}

const centerOf = (p: Pt[]): Pt => ({
  x: p.reduce((s, q) => s + q.x, 0) / p.length,
  y: p.reduce((s, q) => s + q.y, 0) / p.length,
});

/**
 * 건물 윤곽의 각 변을 따라 외벽 두께 중간쯤을 훑어, 양옆이 벽이고 가운데가 빈 구간 = 창.
 * 창 자리 사각형은 윤곽선에서 안쪽으로 양옆 벽 두께만큼.
 */
function windowGaps(slab: Pt[], isWall: (x: number, y: number) => boolean, t: number) {
  const out: { poly: Pt[]; length: number }[] = [];
  const ccw = signedArea(slab) > 0;
  for (let i = 0; i < slab.length; i++) {
    const a = slab[i];
    const b = slab[(i + 1) % slab.length];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 2 * t) continue;
    const d = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
    const n = ccw ? { x: -d.y, y: d.x } : { x: d.y, y: -d.x }; // 건물 안쪽
    const at = (s: number, depth: number) => ({ x: a.x + d.x * s + n.x * depth, y: a.y + d.y * s + n.y * depth });
    const wallAt = (s: number) => [0.35, 0.6, 0.85].some((k) => {
      const p = at(s, t * k);
      return isWall(p.x, p.y);
    });
    // 벽 두께: 윤곽선에서 안쪽으로 벽이 이어지는 길이
    const depthAt = (s: number) => {
      let dd = 0;
      while (dd < 4 * t) {
        const p = at(s, dd + 0.5);
        if (!isWall(p.x, p.y)) break;
        dd++;
      }
      return dd;
    };
    const samples: boolean[] = [];
    for (let s = 0; s <= L; s++) samples.push(wallAt(s));
    let s = 0;
    while (s < samples.length) {
      if (samples[s]) {
        s++;
        continue;
      }
      const s0 = s;
      while (s < samples.length && !samples[s]) s++;
      const s1 = s;
      // 양옆이 벽으로 막힌 구간만 (변 끝까지 비어 있으면 윤곽이 벽을 벗어난 곳)
      if (s0 === 0 || s1 >= samples.length || s1 - s0 < t) continue;
      const depth = Math.max(0.6 * t, Math.min(3 * t, Math.min(depthAt(s0 - 1), depthAt(s1)) || t));
      out.push({ poly: [at(s0, 0), at(s1, 0), at(s1, depth), at(s0, depth)], length: s1 - s0 });
    }
  }
  return out;
}

/** 다각형 내부를 마스크에 칠하기 (짝홀 규칙 스캔라인) */
function fillPolygon(mask: Uint8Array, W: number, H: number, poly: Pt[]) {
  const ys = poly.map((p) => p.y);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)));
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (a.y <= cy !== b.y <= cy) xs.push(a.x + ((cy - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(0, Math.round(xs[k])); x < Math.min(W, Math.round(xs[k + 1])); x++) mask[y * W + x] = 1;
    }
  }
}

/** 여백을 붙인 닫기(close): 이미지 가장자리 벽도 바르게 닫히도록 */
function closeMask(mask: Uint8Array, W: number, H: number, r: number): Uint8Array {
  const p = r + 2;
  const PW = W + 2 * p;
  const PH = H + 2 * p;
  const padded = new Uint8Array(PW * PH);
  for (let y = 0; y < H; y++) padded.set(mask.subarray(y * W, y * W + W), (y + p) * PW + p);
  const c = erode(dilate(padded, PW, PH, r), PW, PH, r);
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) out.set(c.subarray((y + p) * PW + p, (y + p) * PW + p + W), y * W);
  return out;
}

type Stat = { area: number; x0: number; y0: number; w: number; h: number };
function componentStats(map: Int32Array, count: number, W: number): Stat[] {
  const st: Stat[] = Array.from({ length: count + 1 }, () => ({ area: 0, x0: Infinity, y0: Infinity, w: 0, h: 0 }));
  const x1 = new Float64Array(count + 1).fill(-Infinity);
  const y1 = new Float64Array(count + 1).fill(-Infinity);
  for (let i = 0; i < map.length; i++) {
    const l = map[i];
    if (!l) continue;
    const x = i % W;
    const y = (i - x) / W;
    const s = st[l];
    s.area++;
    if (x < s.x0) s.x0 = x;
    if (y < s.y0) s.y0 = y;
    if (x > x1[l]) x1[l] = x;
    if (y > y1[l]) y1[l] = y;
  }
  for (let l = 1; l <= count; l++) {
    st[l].w = x1[l] - st[l].x0 + 1;
    st[l].h = y1[l] - st[l].y0 + 1;
  }
  return st;
}

/**
 * 마스크의 모든 경계 고리 (바깥 외곽선은 양의 면적, 구멍은 음의 면적).
 * 픽셀 모서리를 따라 '벽이 진행방향 오른쪽'이 되게 잇고, 꺾이는 점만 남긴다.
 */
function traceAllLoops(mask: Uint8Array, W: number, H: number): Pt[][] {
  const VW = W + 1;
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x] === 1;
  // 꼭짓점마다 나가는 방향 비트 (0 오른쪽, 1 아래, 2 왼쪽, 3 위)
  const out = new Uint8Array(VW * (H + 1));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      if (!at(x, y - 1)) out[y * VW + x] |= 1;
      if (!at(x + 1, y)) out[y * VW + x + 1] |= 2;
      if (!at(x, y + 1)) out[(y + 1) * VW + x + 1] |= 4;
      if (!at(x - 1, y)) out[(y + 1) * VW + x] |= 8;
    }
  }
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];
  const loops: Pt[][] = [];
  for (let v = 0; v < out.length; v++) {
    while (out[v]) {
      let d = Math.log2(out[v] & -out[v]);
      const sx = v % VW;
      const sy = (v - sx) / VW;
      let x = sx;
      let y = sy;
      const pts: Pt[] = [{ x, y }];
      let prev = d;
      for (let guard = 0; guard < out.length * 4; guard++) {
        const cur = y * VW + x;
        out[cur] &= ~(1 << d);
        if (d !== prev) pts.push({ x, y });
        prev = d;
        x += DX[d];
        y += DY[d];
        if (x === sx && y === sy) break;
        const bits = out[y * VW + x];
        // 오른쪽 우선 → 직진 → 왼쪽 (대각선으로 맞닿은 벽 픽셀을 따로 분리)
        const nd = [(d + 1) % 4, d, (d + 3) % 4].find((c) => bits & (1 << c));
        if (nd === undefined) break;
        d = nd;
      }
      if (pts.length >= 4) loops.push(pts);
    }
  }
  return loops;
}
