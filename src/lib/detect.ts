import { insetPolygon, polygonArea, signedArea } from "./geometry";
import type { Pt } from "./types";

// 평면도 이미지 → 방 다각형(이미지 px, 벽 중심선 기준).
// 서버 없이 브라우저에서 도는 고전적 영상처리 방식:
//  1) 어두운 픽셀 = 벽/선, 벽 두께는 어두운 픽셀 연속 길이의 최빈값으로 추정
//  2) 얇은 선을 지워 벽만 남기고, 8방향 중 5방향 이상 벽으로 막힌 곳을 건물 안으로 본다
//     건물 안 빈 공간을 침식해 문틈을 막고 방 씨앗을 얻는다
//  3) 씨앗에서 동시에 퍼져나가며 빈 공간을 나눠 갖는다 (문 자리는 반씩)
//  4) 영역 외곽선 → 단순화 → 직교 정리 → 반 벽두께만큼 바깥으로 → 방끼리 좌표 정렬

export type DetectOptions = {
  /** 문틈 막기 강도 (1 = 문 폭 약 900mm 기준) */
  gapStrength: number;
};

export type DetectResult = {
  rooms: Pt[][];
  /** 추정 벽 두께 (원본 이미지 px) */
  wallPx: number;
  /** 벽 두께를 200mm로 가정한 축척 추정치 */
  mmPerPxGuess: number;
  /** 원본 px 기준 라벨 맵 조회 (클릭한 위치의 방 찾기용) */
  roomAt: (p: Pt) => number;
};

export type Gray = { data: Uint8ClampedArray; width: number; height: number };

const MAX_DIM = 1400;

export function detectRooms(img: Gray, opts: DetectOptions): DetectResult {
  // 처리 해상도로 축소
  const f = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
  const W = Math.max(1, Math.round(img.width * f));
  const H = Math.max(1, Math.round(img.height * f));
  const lum = resizeLum(img, W, H);

  const thr = Math.max(60, Math.min(170, otsu(lum)));
  const dark = new Uint8Array(W * H);
  for (let i = 0; i < lum.length; i++) dark[i] = lum[i] < thr ? 1 : 0;

  const t = estimateWallThickness(dark, W, H);
  // 글자·문 열림 호·창 표시선·치수선처럼 얇은 선은 지우고 두꺼운 벽만 남긴다
  // 커널은 내벽(외벽의 절반 정도)보다 충분히 작게
  const k = Math.max(1, Math.floor(t * 0.15));
  const wall = dilate(erode(dark, W, H, k), W, H, k);
  // 굵은 글씨(방 이름)처럼 벽과 떨어진 작은 덩어리도 지운다
  removeSmallBlobs(wall, W, H, 3 * t);
  const free = new Uint8Array(W * H);
  for (let i = 0; i < free.length; i++) free[i] = wall[i] ? 0 : 1;

  // 건물 안쪽 판정. 창은 얇은 선이라 지워져서 벽에 큰 틈이 생기지만 나머지 방향은 막혀 있다.
  const inside = insideMask(wall, W, H);
  // 앞뒤 창이 일직선으로 뚫린 거실처럼 광선 판정이 놓치는 곳은 외곽을 크게 메운 건물 윤곽으로 보완
  const footprint = footprintMask(wall, W, H, Math.round(10 * t));
  for (let i = 0; i < inside.length; i++) inside[i] = inside[i] || footprint[i] ? 1 : 0;

  const r = Math.max(2, Math.round(2.4 * t * opts.gapStrength));
  const core = new Uint8Array(W * H);
  for (let i = 0; i < core.length; i++) core[i] = free[i] && inside[i] ? 1 : 0;
  const lab = label(erode(core, W, H, r), W, H);
  const border = borderLabels(lab, W, H);

  // 씨앗: -1 바깥, 1.. 방 (문틈을 막은 뒤 남는 덩어리)
  const seeds = new Int32Array(W * H);
  const ids = new Map<number, number>();
  let next = 1;
  for (let i = 0; i < seeds.length; i++) {
    if (free[i] && !inside[i]) {
      seeds[i] = -1;
      continue;
    }
    const l = lab.map[i];
    if (!l || border.has(l)) continue;
    let id = ids.get(l);
    if (id === undefined) ids.set(l, (id = next++));
    seeds[i] = id;
  }

  const regions = grow(seeds, free, W, H);

  // 영역 → 다각형
  const minArea = (4 * t) ** 2;
  const polys: Pt[][] = [];
  const labelToRoom = new Map<number, number>();
  for (let id = 1; id < next; id++) {
    const loop = traceOuter(regions, W, H, id);
    if (!loop || polygonArea(loop) < minArea) continue;
    let p = simplifyClosed(loop, Math.max(1.5, t * 0.7));
    p = orthogonalize(p);
    if (p.length < 3 || polygonArea(p) < minArea) continue;
    p = insetPolygon(p, -t / 2).inset;
    labelToRoom.set(id, polys.length);
    polys.push(p);
  }
  alignAcrossRooms(polys, t * 0.8);

  const rooms = polys
    .map((p) => cleanup(p).map((q) => ({ x: q.x / f, y: q.y / f })))
    .filter((p) => p.length >= 3);
  const wallPx = t / f;

  return {
    rooms,
    wallPx,
    mmPerPxGuess: 200 / wallPx,
    roomAt: (p) => {
      const x = Math.floor(p.x * f);
      const y = Math.floor(p.y * f);
      if (x < 0 || y < 0 || x >= W || y >= H) return -1;
      return labelToRoom.get(regions[y * W + x]) ?? -1;
    },
  };
}

// ---------- 픽셀 처리 ----------

export function resizeLum(img: Gray, W: number, H: number): Uint8Array {
  const out = new Uint8Array(W * H);
  const sx = img.width / W;
  const sy = img.height / H;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // 축소 구간 안에서 가장 어두운 값 (얇은 벽이 축소로 사라지지 않게)
      let m = 255;
      const x0 = Math.floor(x * sx);
      const y0 = Math.floor(y * sy);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * img.width + xx) * 4;
          const a = img.data[i + 3] / 255;
          const l = (0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]) * a + 255 * (1 - a);
          if (l < m) m = l;
        }
      }
      out[y * W + x] = m;
    }
  }
  return out;
}

export function otsu(lum: Uint8Array): number {
  const hist = new Float64Array(256);
  for (const v of lum) hist[v]++;
  const total = lum.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let thr = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      thr = i;
    }
  }
  return thr;
}

/** 어두운 픽셀의 가로/세로 연속 길이 최빈값 = 벽 두께 */
export function estimateWallThickness(dark: Uint8Array, W: number, H: number): number {
  const maxLen = Math.max(8, Math.min(80, Math.round(Math.max(W, H) / 12)));
  const hist = new Float64Array(maxLen + 1);
  const add = (len: number) => {
    if (len >= 3 && len <= maxLen) hist[len] += len; // 긴 런에 가중치 (글자 획보다 벽이 두꺼움)
  };
  for (let y = 0; y < H; y++) {
    let run = 0;
    for (let x = 0; x < W; x++) {
      if (dark[y * W + x]) run++;
      else {
        add(run);
        run = 0;
      }
    }
    add(run);
  }
  for (let x = 0; x < W; x++) {
    let run = 0;
    for (let y = 0; y < H; y++) {
      if (dark[y * W + x]) run++;
      else {
        add(run);
        run = 0;
      }
    }
    add(run);
  }
  // 이웃 길이와 묶어서 최빈 구간 찾기
  let best = 6;
  let bestScore = -1;
  for (let l = 3; l <= maxLen; l++) {
    const s = hist[l] + 0.5 * ((hist[l - 1] ?? 0) + (hist[l + 1] ?? 0));
    if (s > bestScore) {
      bestScore = s;
      best = l;
    }
  }
  return best;
}

export function dilate(mask: Uint8Array, W: number, H: number, r: number): Uint8Array {
  const inv = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) inv[i] = mask[i] ? 0 : 1;
  const e = erode(inv, W, H, r);
  for (let i = 0; i < e.length; i++) e[i] = e[i] ? 0 : 1;
  return e;
}

/**
 * 건물 안쪽 판정: 8방향(상하좌우+대각선)으로 뻗었을 때 5방향 이상에서 벽을 만나는 칸.
 * 앞뒤로 창이 난 거실-주방(맞통풍 판상형)도 옆과 대각선은 막혀 있어 안쪽으로 잡힌다.
 */
function insideMask(wall: Uint8Array, W: number, H: number): Uint8Array {
  const hits = new Uint8Array(W * H);
  const dirs: [number, number][] = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [-1, -1], [1, -1], [-1, 1],
  ];
  const seen = new Uint8Array(W * H);
  for (const [dx, dy] of dirs) {
    // (dx,dy) 쪽에 벽이 있는지: 그 방향 반대쪽부터 훑으며 누적
    seen.fill(0);
    const ys = dy > 0 ? range(H - 1, -1, -1) : range(0, H, 1);
    const xs = dx > 0 ? range(W - 1, -1, -1) : range(0, W, 1);
    for (const y of ys) {
      for (const x of xs) {
        const i = y * W + x;
        const nx = x + dx;
        const ny = y + dy;
        const nIn = nx >= 0 && ny >= 0 && nx < W && ny < H;
        const ahead = nIn ? wall[ny * W + nx] || seen[ny * W + nx] : 0;
        seen[i] = ahead;
        if (!wall[i] && ahead) hits[i]++;
      }
    }
  }
  for (let i = 0; i < hits.length; i++) hits[i] = hits[i] >= 5 ? 1 : 0;
  return hits;
}

/** 벽을 크게 닫아(close) 창 틈까지 메운 뒤, 테두리에서 닿지 않는 부분 = 건물 윤곽 */
export function footprintMask(wall: Uint8Array, W: number, H: number, rc: number): Uint8Array {
  // 이미지 밖을 빈 공간으로 두고 닫기 위해 여백을 붙여 계산
  const p = rc + 2;
  const PW = W + 2 * p;
  const PH = H + 2 * p;
  const padded = new Uint8Array(PW * PH);
  for (let y = 0; y < H; y++) padded.set(wall.subarray(y * W, y * W + W), (y + p) * PW + p);
  const closed = erode(dilate(padded, PW, PH, rc), PW, PH, rc);
  const open = new Uint8Array(PW * PH);
  for (let i = 0; i < open.length; i++) open[i] = closed[i] ? 0 : 1;
  const lab = label(open, PW, PH);
  const border = borderLabels(lab, PW, PH);
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const l = lab.map[(y + p) * PW + x + p];
      out[y * W + x] = l && border.has(l) ? 0 : 1;
    }
  }
  return out;
}

function range(start: number, end: number, step: number): number[] {
  const out: number[] = [];
  for (let v = start; v !== end; v += step) out.push(v);
  return out;
}

/** 정사각 커널 침식 (가로·세로 분리, 창 안의 0 개수로 O(n)) */
export function erode(mask: Uint8Array, W: number, H: number, r: number): Uint8Array {
  const tmp = new Uint8Array(W * H);
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    let zeros = 0;
    // 이미지 밖은 빈 공간으로 본다 (테두리 영역이 바깥으로 이어지도록)
    for (let x = -r; x <= r; x++) if (x >= 0 && x < W && !mask[row + x]) zeros++;
    for (let x = 0; x < W; x++) {
      tmp[row + x] = zeros ? 0 : 1;
      const out0 = x - r;
      const in1 = x + r + 1;
      if (out0 >= 0 && !mask[row + out0]) zeros--;
      if (in1 < W && !mask[row + in1]) zeros++;
    }
  }
  for (let x = 0; x < W; x++) {
    let zeros = 0;
    for (let y = -r; y <= r; y++) if (y >= 0 && y < H && !tmp[y * W + x]) zeros++;
    for (let y = 0; y < H; y++) {
      out[y * W + x] = zeros ? 0 : 1;
      const out0 = y - r;
      const in1 = y + r + 1;
      if (out0 >= 0 && !tmp[out0 * W + x]) zeros--;
      if (in1 < H && !tmp[in1 * W + x]) zeros++;
    }
  }
  return out;
}

export function removeSmallBlobs(mask: Uint8Array, W: number, H: number, maxSide: number) {
  const lab = label(mask, W, H);
  const minX = new Int32Array(lab.count + 1).fill(W);
  const minY = new Int32Array(lab.count + 1).fill(H);
  const maxX = new Int32Array(lab.count + 1).fill(-1);
  const maxY = new Int32Array(lab.count + 1).fill(-1);
  for (let i = 0; i < mask.length; i++) {
    const l = lab.map[i];
    if (!l) continue;
    const x = i % W;
    const y = (i - x) / W;
    if (x < minX[l]) minX[l] = x;
    if (x > maxX[l]) maxX[l] = x;
    if (y < minY[l]) minY[l] = y;
    if (y > maxY[l]) maxY[l] = y;
  }
  for (let i = 0; i < mask.length; i++) {
    const l = lab.map[i];
    if (l && Math.max(maxX[l] - minX[l], maxY[l] - minY[l]) < maxSide) mask[i] = 0;
  }
}

export function label(mask: Uint8Array, W: number, H: number): { map: Int32Array; count: number } {
  const map = new Int32Array(W * H);
  const stack = new Int32Array(W * H);
  let count = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || map[i]) continue;
    count++;
    let sp = 0;
    stack[sp++] = i;
    map[i] = count;
    while (sp) {
      const j = stack[--sp];
      const x = j % W;
      const y = (j - x) / W;
      const nb = [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, y > 0 ? j - W : -1, y < H - 1 ? j + W : -1];
      for (const k of nb) {
        if (k >= 0 && mask[k] && !map[k]) {
          map[k] = count;
          stack[sp++] = k;
        }
      }
    }
  }
  return { map, count };
}

export function borderLabels(lab: { map: Int32Array }, W: number, H: number): Set<number> {
  const s = new Set<number>();
  for (let x = 0; x < W; x++) {
    if (lab.map[x]) s.add(lab.map[x]);
    if (lab.map[(H - 1) * W + x]) s.add(lab.map[(H - 1) * W + x]);
  }
  for (let y = 0; y < H; y++) {
    if (lab.map[y * W]) s.add(lab.map[y * W]);
    if (lab.map[y * W + W - 1]) s.add(lab.map[y * W + W - 1]);
  }
  return s;
}

/** 여러 씨앗에서 동시에 빈 공간으로 퍼지기 (먼저 닿은 쪽이 차지) */
function grow(seeds: Int32Array, free: Uint8Array, W: number, H: number): Int32Array {
  const lab = Int32Array.from(seeds);
  const queue = new Int32Array(W * H);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < lab.length; i++) if (lab[i]) queue[tail++] = i;
  while (head < tail) {
    const j = queue[head++];
    const x = j % W;
    const l = lab[j];
    // 8방향으로 퍼져야 방 모서리가 자기 방 씨앗에 더 가깝게 계산돼서 문 너머 방이 모서리를 뺏지 않는다
    const L = x > 0;
    const Rt = x < W - 1;
    const nb = [
      L ? j - 1 : -1, Rt ? j + 1 : -1, j - W, j + W,
      L ? j - W - 1 : -1, Rt ? j - W + 1 : -1, L ? j + W - 1 : -1, Rt ? j + W + 1 : -1,
    ];
    for (const k of nb) {
      if (k >= 0 && k < lab.length && free[k] && !lab[k]) {
        lab[k] = l;
        queue[tail++] = k;
      }
    }
  }
  return lab;
}

// ---------- 외곽선 ----------

/** 라벨 영역의 바깥 외곽선 (픽셀 모서리 좌표, 꺾이는 점만) */
export function traceOuter(lab: Int32Array, W: number, H: number, id: number): Pt[] | null {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && lab[y * W + x] === id;
  let sx = -1;
  let sy = -1;
  for (let i = 0; i < lab.length && sx < 0; i++) {
    if (lab[i] === id) {
      sx = i % W;
      sy = (i - sx) / W;
    }
  }
  if (sx < 0) return null;
  // 경계를 따라 돌기: 방향 0=오른쪽 1=아래 2=왼쪽 3=위, 영역이 진행방향 오른쪽에 있도록
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];
  // 꼭짓점 (vx,vy)에서 방향 d로 갈 수 있는지: 진행방향 오른쪽 셀은 안, 왼쪽 셀은 밖
  const cellRight = (vx: number, vy: number, d: number): [number, number] =>
    [
      [vx, vy],
      [vx - 1, vy],
      [vx - 1, vy - 1],
      [vx, vy - 1],
    ][d] as [number, number];
  const cellLeft = (vx: number, vy: number, d: number): [number, number] =>
    [
      [vx, vy - 1],
      [vx, vy],
      [vx - 1, vy],
      [vx - 1, vy - 1],
    ][d] as [number, number];
  const ok = (vx: number, vy: number, d: number) => inside(...cellRight(vx, vy, d)) && !inside(...cellLeft(vx, vy, d));

  let vx = sx;
  let vy = sy;
  let d = 0;
  const pts: Pt[] = [];
  const limit = 4 * (W + H) * 50;
  for (let n = 0; n < limit; n++) {
    // 오른쪽 우선 → 직진 → 왼쪽 (바깥 외곽선을 따라감)
    let moved = false;
    for (const turn of [1, 0, 3, 2]) {
      const nd = (d + turn) % 4;
      if (ok(vx, vy, nd)) {
        if (nd !== d || pts.length === 0) pts.push({ x: vx, y: vy });
        d = nd;
        vx += DX[d];
        vy += DY[d];
        moved = true;
        break;
      }
    }
    if (!moved) return null;
    if (vx === sx && vy === sy) break;
  }
  return pts.length >= 4 ? pts : null;
}

export function simplifyClosed(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 4) return pts;
  // 시작점에서 가장 먼 점으로 둘로 나눠 각각 더글라스-포이커
  let far = 0;
  let fd = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = (pts[i].x - pts[0].x) ** 2 + (pts[i].y - pts[0].y) ** 2;
    if (d > fd) {
      fd = d;
      far = i;
    }
  }
  const a = dp(pts.slice(0, far + 1), eps);
  const b = dp([...pts.slice(far), pts[0]], eps);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

function dp(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  let idx = -1;
  let md = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((b.x - a.x) * (a.y - pts[i].y) - (a.x - pts[i].x) * (b.y - a.y)) / len;
    if (d > md) {
      md = d;
      idx = i;
    }
  }
  if (md <= eps) return [a, b];
  return [...dp(pts.slice(0, idx + 1), eps).slice(0, -1), ...dp(pts.slice(idx), eps)];
}

/** 수평/수직에 가까운 변을 축에 맞추고, 연속한 축 변의 교점을 꼭짓점으로 */
export function orthogonalize(pts: Pt[], tolDeg = 15): Pt[] {
  const n = pts.length;
  type E = { kind: "h" | "v" | "d"; val: number };
  const edges: E[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const ang = (Math.atan2(Math.abs(b.y - a.y), Math.abs(b.x - a.x)) * 180) / Math.PI;
    if (ang < tolDeg) edges.push({ kind: "h", val: (a.y + b.y) / 2 });
    else if (ang > 90 - tolDeg) edges.push({ kind: "v", val: (a.x + b.x) / 2 });
    else edges.push({ kind: "d", val: 0 });
  }
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const prev = edges[(i - 1 + n) % n];
    const cur = edges[i];
    if (prev.kind === "h" && cur.kind === "v") out.push({ x: cur.val, y: prev.val });
    else if (prev.kind === "v" && cur.kind === "h") out.push({ x: prev.val, y: cur.val });
    else if (prev.kind === cur.kind && prev.kind !== "d") {
      // 같은 방향 변이 이어지면 꼭짓점 생략 (값이 다르면 계단 → 짧은 수직/수평 변 삽입)
      if (Math.abs(prev.val - cur.val) > 0.5) {
        const p = pts[i];
        if (cur.kind === "h") out.push({ x: p.x, y: prev.val }, { x: p.x, y: cur.val });
        else out.push({ x: prev.val, y: p.y }, { x: cur.val, y: p.y });
      }
    } else {
      // 사선 변과 닿는 꼭짓점: 축 변 쪽 값만 맞춘다
      const p = { ...pts[i] };
      if (prev.kind === "h" || cur.kind === "h") p.y = prev.kind === "h" ? prev.val : cur.val;
      if (prev.kind === "v" || cur.kind === "v") p.x = prev.kind === "v" ? prev.val : cur.val;
      out.push(p);
    }
  }
  return cleanup(out);
}

/** 중복점·일직선 위의 점 제거 */
export function cleanup(pts: Pt[]): Pt[] {
  let p = pts.filter((q, i) => {
    const r = pts[(i + 1) % pts.length];
    return Math.hypot(q.x - r.x, q.y - r.y) > 0.5;
  });
  let changed = true;
  while (changed && p.length > 3) {
    changed = false;
    for (let i = 0; i < p.length; i++) {
      const a = p[(i - 1 + p.length) % p.length];
      const b = p[i];
      const c = p[(i + 1) % p.length];
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      const len = Math.hypot(c.x - a.x, c.y - a.y) || 1;
      if (Math.abs(cross) / len < 0.5) {
        p = p.filter((_, j) => j !== i);
        changed = true;
        break;
      }
    }
  }
  if (p.length >= 3 && Math.abs(signedArea(p)) < 1) return [];
  return p;
}

/** 방들 사이 x, y 좌표를 묶어 같은 벽은 같은 선 위에 오도록 */
function alignAcrossRooms(polys: Pt[][], tol: number) {
  for (const axis of ["x", "y"] as const) {
    const refs = polys.flatMap((p, pi) => p.map((q, qi) => ({ v: q[axis], pi, qi })));
    refs.sort((a, b) => a.v - b.v);
    let i = 0;
    while (i < refs.length) {
      let j = i + 1;
      while (j < refs.length && refs[j].v - refs[j - 1].v <= tol && refs[j].v - refs[i].v <= tol * 2) j++;
      const mean = refs.slice(i, j).reduce((s, r) => s + r.v, 0) / (j - i);
      for (let k = i; k < j; k++) polys[refs[k].pi][refs[k].qi][axis] = mean;
      i = j;
    }
  }
}
