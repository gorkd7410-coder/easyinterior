import { uid } from "./geometry";
import { finishFor } from "./materials";
import { fitScaleToArea } from "./project";
import type { Opening, OpeningKind, Project, Room, RoomType } from "./types";
import { OPENING_DEFAULTS } from "./types";

// 평수만으로 바로 골조를 띄우기 위한 대표 평면 템플릿 (실제 단지 평면과 차이가 있다).
// 좌표는 mm, 위쪽이 북측(현관), 아래쪽이 남측(발코니/창).

const MM_PER_PX = 10;
const MARGIN = 1500;

type RoomDef = [name: string, type: RoomType, x0: number, y0: number, x1: number, y1: number];
type OpeningDef = [kind: OpeningKind, ax: number, ay: number, bx: number, by: number, sill?: number, head?: number];

export type Template = {
  id: string;
  name: string;
  description: string;
  areaM2: number;
  rooms: RoomDef[];
  openings: OpeningDef[];
};

export const TEMPLATES: Template[] = [
  {
    id: "apt59",
    name: "59㎡ (25평형) 3Bay",
    description: "침실2 · 거실 · 안방 남향 배치, 확장형 기준",
    areaM2: 59,
    rooms: [
      ["욕실", "bath", 0, 0, 2000, 2600],
      ["현관", "entry", 2000, 0, 3500, 2600],
      ["주방", "kitchen", 3500, 0, 7000, 2600],
      ["다용도실", "etc", 7000, 0, 9600, 2600],
      ["침실2", "bedroom", 0, 2600, 2900, 6200],
      ["거실", "living", 2900, 2600, 6300, 6200],
      ["안방", "bedroom", 6300, 2600, 9600, 6200],
    ],
    openings: [
      ["door", 2300, 0, 3200, 0],
      ["door", 2000, 1200, 2000, 1900],
      ["open", 2900, 2600, 6300, 2600],
      ["door", 7000, 800, 7000, 1600],
      ["door", 2900, 2800, 2900, 3700],
      ["door", 6300, 2800, 6300, 3700],
      ["window", 4400, 0, 6000, 0, 1100, 2100],
      ["window", 400, 6200, 2500, 6200],
      ["window", 3200, 6200, 6000, 6200, 0, 2200],
      ["window", 6800, 6200, 9100, 6200],
    ],
  },
  {
    id: "apt84",
    name: "84㎡ (34평형) 4Bay",
    description: "침실2 · 거실 · 안방 · 침실3 남향 배치, 확장형 기준",
    areaM2: 84,
    rooms: [
      ["공용욕실", "bath", 0, 0, 2200, 3100],
      ["현관", "entry", 2200, 0, 3700, 3100],
      ["주방", "kitchen", 3700, 0, 7000, 3100],
      ["드레스룸", "etc", 7000, 0, 8800, 3100],
      ["안방욕실", "bath", 8800, 0, 10600, 3100],
      ["알파룸", "etc", 10600, 0, 12600, 3100],
      ["침실2", "bedroom", 0, 3100, 2900, 6700],
      ["거실", "living", 2900, 3100, 7000, 6700],
      ["안방", "bedroom", 7000, 3100, 10300, 6700],
      ["침실3", "bedroom", 10300, 3100, 12600, 6700],
    ],
    openings: [
      ["door", 2500, 0, 3400, 0],
      ["door", 2200, 1500, 2200, 2300],
      ["open", 2900, 3100, 7000, 3100],
      ["door", 2900, 3300, 2900, 4200],
      ["door", 7000, 3300, 7000, 4200],
      ["door", 7300, 3100, 8100, 3100],
      ["door", 9100, 3100, 9900, 3100],
      ["door", 10900, 3100, 11700, 3100],
      ["window", 4300, 0, 6400, 0, 1100, 2100],
      ["window", 400, 6700, 2500, 6700],
      ["window", 3300, 6700, 6600, 6700, 0, 2200],
      ["window", 7400, 6700, 9900, 6700],
      ["window", 10700, 6700, 12200, 6700],
    ],
  },
];

const toPx = (mm: number) => (mm + MARGIN) / MM_PER_PX;

export function projectFromTemplate(t: Template): Project {
  const rooms: Room[] = t.rooms.map(([name, type, x0, y0, x1, y1]) => {
    const f = finishFor(type);
    return {
      id: uid(),
      name,
      type,
      points: [
        { x: toPx(x0), y: toPx(y0) },
        { x: toPx(x1), y: toPx(y0) },
        { x: toPx(x1), y: toPx(y1) },
        { x: toPx(x0), y: toPx(y1) },
      ],
      floorMat: f.floor,
      wallMat: f.wall,
    };
  });
  const openings: Opening[] = t.openings.map(([kind, ax, ay, bx, by, sill, head]) => ({
    id: uid(),
    kind,
    a: { x: toPx(ax), y: toPx(ay) },
    b: { x: toPx(bx), y: toPx(by) },
    sill: sill ?? OPENING_DEFAULTS[kind].sill,
    head: head ?? OPENING_DEFAULTS[kind].head,
  }));
  const project = { ...emptyProject(), name: t.name, rooms, openings };
  // 중심선 치수로 잡은 템플릿을 안목 전용면적에 맞게 살짝 늘린다
  return { ...project, mmPerPx: fitScaleToArea(project, t.areaM2) };
}

export function emptyProject(): Project {
  return {
    version: 1,
    name: "새 프로젝트",
    image: null,
    canvas: { width: 1600, height: 1100 },
    mmPerPx: MM_PER_PX,
    wallHeight: 2300,
    wallThickness: 150,
    rooms: [],
    openings: [],
  };
}
