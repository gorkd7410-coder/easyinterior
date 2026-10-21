import { ShapeUtils, Vector2 } from "three";
import { dist, insetPolygon, signedArea } from "./geometry";
import { getMaterial } from "./materials";
import type { Opening, Project, Pt, Room } from "./types";

// 프로젝트 → 3D 메쉬 데이터.
// 모델 좌표계: mm, Z-up (스케치업/Collada 기준). X = 평면 x, Y = -평면 y, Z = 높이.
// 3D 뷰어와 내보내기가 같은 데이터를 쓰므로 화면과 파일이 항상 일치한다.

export type V3 = [number, number, number];

export type MeshPart = {
  materialId: string;
  positions: number[];
  normals: number[];
  uvs: number[];
};

export type RoomMesh = {
  roomId: string;
  name: string;
  parts: MeshPart[];
};

class PartBuilder {
  parts = new Map<string, MeshPart>();

  private part(materialId: string) {
    let p = this.parts.get(materialId);
    if (!p) {
      p = { materialId, positions: [], normals: [], uvs: [] };
      this.parts.set(materialId, p);
    }
    return p;
  }

  /** 삼각형 추가. normal 방향과 맞도록 감기 순서를 자동 보정 */
  tri(mat: string, a: V3, b: V3, c: V3, ua: [number, number], ub: [number, number], uc: [number, number], n: V3) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1];
    const cy = e1[2] * e2[0] - e1[0] * e2[2];
    const cz = e1[0] * e2[1] - e1[1] * e2[0];
    if (cx * n[0] + cy * n[1] + cz * n[2] < 0) {
      [b, c] = [c, b];
      [ub, uc] = [uc, ub];
    }
    const p = this.part(mat);
    p.positions.push(...a, ...b, ...c);
    p.normals.push(...n, ...n, ...n);
    p.uvs.push(...ua, ...ub, ...uc);
  }

  quad(mat: string, v: [V3, V3, V3, V3], uv: [number, number][], n: V3) {
    this.tri(mat, v[0], v[1], v[2], uv[0], uv[1], uv[2], n);
    this.tri(mat, v[0], v[2], v[3], uv[0], uv[2], uv[3], n);
  }
}

type Interval = { s0: number; s1: number; sill: number; head: number };

/** 방 모서리(px) 위에 놓인 개구부들을 모서리 기준 거리(mm) 구간으로 */
function openingsOnEdge(a: Pt, b: Pt, openings: Opening[], mmPerPx: number, wallHeight: number): Interval[] {
  const L = dist(a, b);
  if (L === 0) return [];
  const d = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
  const tolPx = 60 / mmPerPx; // 60mm 이내면 같은 벽으로 본다
  const res: Interval[] = [];
  for (const o of openings) {
    const off = (p: Pt) => Math.abs((p.x - a.x) * d.y - (p.y - a.y) * d.x);
    if (off(o.a) > tolPx || off(o.b) > tolPx) continue;
    const sa = (o.a.x - a.x) * d.x + (o.a.y - a.y) * d.y;
    const sb = (o.b.x - a.x) * d.x + (o.b.y - a.y) * d.y;
    const s0 = Math.max(0, Math.min(sa, sb));
    const s1 = Math.min(L, Math.max(sa, sb));
    if (s1 - s0 < 1) continue;
    res.push({
      s0: s0 * mmPerPx,
      s1: s1 * mmPerPx,
      sill: Math.max(0, Math.min(o.sill, wallHeight)),
      head: Math.max(0, Math.min(o.head, wallHeight)),
    });
  }
  return res.sort((x, y) => x.s0 - y.s0);
}

export function buildRoomMesh(room: Room, project: Project): RoomMesh {
  const { mmPerPx, wallHeight: H } = project;
  const half = project.wallThickness / 2;
  const pb = new PartBuilder();
  const floor = getMaterial(room.floorMat);
  const wall = getMaterial(room.wallMat);

  // 평면 px → 모델 평면 mm (X, Y)
  const P = (p: Pt): [number, number] => [p.x * mmPerPx, -p.y * mmPerPx];
  const pts = room.points;
  if (pts.length < 3 || Math.abs(signedArea(pts)) < 1e-6) {
    return { roomId: room.id, name: room.name, parts: [] };
  }

  // 바닥: 벽 안쪽 면 기준
  const insetPx = insetPolygon(pts, half / mmPerPx).inset;
  const floor2d = insetPx.map((p) => new Vector2(...P(p)));
  const tris = ShapeUtils.triangulateShape(floor2d, []);
  for (const [i, j, k] of tris) {
    const v = [floor2d[i], floor2d[j], floor2d[k]];
    pb.tri(
      floor.id,
      [v[0].x, v[0].y, 0],
      [v[1].x, v[1].y, 0],
      [v[2].x, v[2].y, 0],
      [v[0].x / floor.tileW, v[0].y / floor.tileH],
      [v[1].x / floor.tileW, v[1].y / floor.tileH],
      [v[2].x / floor.tileW, v[2].y / floor.tileH],
      [0, 0, 1],
    );
  }

  // 벽: 방마다 중심선에서 안쪽으로 반 두께씩. 인접한 방의 벽과 등을 맞대 전체 두께가 된다.
  const n = pts.length;
  let uOffset = 0; // 벽지 무늬가 모서리를 따라 이어지도록
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const Lmm = dist(a, b) * mmPerPx;
    if (Lmm < 1) continue;
    const [ax, ay] = P(a);
    const [bx, by] = P(b);
    const dx = (bx - ax) / Lmm;
    const dy = (by - ay) / Lmm;
    const [q0x, q0y] = P(insetPx[i]);
    const [q1x, q1y] = P(insetPx[(i + 1) % n]);
    // 안쪽 방향 (모델 좌표)
    const midIn = [(q0x + q1x) / 2 - (ax + bx) / 2, (q0y + q1y) / 2 - (ay + by) / 2];
    const nl = Math.hypot(midIn[0], midIn[1]) || 1;
    const nx = midIn[0] / nl;
    const ny = midIn[1] / nl;

    const center = (s: number): [number, number] => [ax + dx * s, ay + dy * s];
    const inner = (s: number): [number, number] => {
      if (s <= 0) return [q0x, q0y];
      if (s >= Lmm) return [q1x, q1y];
      return [ax + dx * s + nx * half, ay + dy * s + ny * half];
    };

    // 구간 나누기
    const cuts = openingsOnEdge(a, b, project.openings, mmPerPx, H);
    type Piece = { s0: number; s1: number; z0: number; z1: number };
    const pieces: Piece[] = [];
    let cursor = 0;
    for (const c of cuts) {
      if (c.s0 > cursor) pieces.push({ s0: cursor, s1: c.s0, z0: 0, z1: H });
      const s0 = Math.max(c.s0, cursor);
      if (c.s1 > s0) {
        if (c.sill > 0) pieces.push({ s0, s1: c.s1, z0: 0, z1: c.sill });
        if (c.head < H) pieces.push({ s0, s1: c.s1, z0: c.head, z1: H });
        cursor = c.s1;
      }
    }
    if (cursor < Lmm) pieces.push({ s0: cursor, s1: Lmm, z0: 0, z1: H });

    for (const pc of pieces) {
      const c0 = center(pc.s0);
      const c1 = center(pc.s1);
      const i0 = inner(pc.s0);
      const i1 = inner(pc.s1);
      const { z0, z1 } = pc;
      const u0 = (uOffset + pc.s0) / wall.tileW;
      const u1 = (uOffset + pc.s1) / wall.tileW;
      const v0 = z0 / wall.tileH;
      const v1 = z1 / wall.tileH;
      // 안쪽 마감면
      pb.quad(
        wall.id,
        [[...i0, z0], [...i1, z0], [...i1, z1], [...i0, z1]],
        [[u0, v0], [u1, v0], [u1, v1], [u0, v1]],
        [nx, ny, 0],
      );
      // 벽체 등면 (외벽이면 건물 외부, 내벽이면 이웃 방 벽과 맞닿아 보이지 않음)
      const coreUv: [number, number][] = [[0, 0], [0, 0], [0, 0], [0, 0]];
      pb.quad("core", [[...c0, z0], [...c1, z0], [...c1, z1], [...c0, z1]], coreUv, [-nx, -ny, 0]);
      // 윗면/아랫면
      pb.quad("core", [[...c0, z1], [...c1, z1], [...i1, z1], [...i0, z1]], coreUv, [0, 0, 1]);
      if (z0 > 0) pb.quad("core", [[...c0, z0], [...c1, z0], [...i1, z0], [...i0, z0]], coreUv, [0, 0, -1]);
      // 개구부 쪽 마구리면. 방 모서리 쪽은 옆 벽과 맞물리고,
      // 창 아래/위 조각은 양옆 전체높이 벽 사이에 끼므로 전체높이 조각만 만든다.
      const fullHeight = z0 === 0 && z1 === H;
      if (fullHeight && pc.s0 > 0) pb.quad("core", [[...c0, z0], [...i0, z0], [...i0, z1], [...c0, z1]], coreUv, [-dx, -dy, 0]);
      if (fullHeight && pc.s1 < Lmm) pb.quad("core", [[...c1, z0], [...i1, z0], [...i1, z1], [...c1, z1]], coreUv, [dx, dy, 0]);
    }
    uOffset += Lmm;
  }

  return { roomId: room.id, name: room.name, parts: [...pb.parts.values()] };
}

export function buildProject(project: Project): RoomMesh[] {
  return project.rooms.map((r) => buildRoomMesh(r, project));
}
