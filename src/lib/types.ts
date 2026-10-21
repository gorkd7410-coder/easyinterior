// 평면 좌표는 평면도 이미지 픽셀 단위로 저장하고, mmPerPx로 실제 치수(mm)로 환산한다.
// 축척을 다시 잡아도 그려둔 도형이 움직이지 않게 하기 위함.

export type Pt = { x: number; y: number };

export type RoomType =
  | "living"
  | "bedroom"
  | "kitchen"
  | "bath"
  | "entry"
  | "balcony"
  | "etc";

export const ROOM_TYPE_LABEL: Record<RoomType, string> = {
  living: "거실",
  bedroom: "침실",
  kitchen: "주방",
  bath: "욕실",
  entry: "현관",
  balcony: "발코니",
  etc: "기타",
};

export type Room = {
  id: string;
  name: string;
  type: RoomType;
  points: Pt[]; // 벽 중심선 기준 다각형
  floorMat: string;
  wallMat: string;
};

export type OpeningKind = "door" | "window" | "open";

export const OPENING_LABEL: Record<OpeningKind, string> = {
  door: "문",
  window: "창",
  open: "개구부(벽 없음)",
};

export type Opening = {
  id: string;
  kind: OpeningKind;
  a: Pt;
  b: Pt;
  sill: number; // mm, 바닥에서 하단까지
  head: number; // mm, 바닥에서 상단까지
};

export type PlanImage = {
  dataUrl: string;
  width: number;
  height: number;
};

export type Project = {
  version: 1;
  name: string;
  image: PlanImage | null;
  canvas: { width: number; height: number }; // 이미지가 없을 때 작업 영역(px)
  mmPerPx: number;
  wallHeight: number; // mm
  wallThickness: number; // mm (방 사이 벽 전체 두께)
  rooms: Room[];
  openings: Opening[];
};

export const OPENING_DEFAULTS: Record<OpeningKind, { sill: number; head: number }> = {
  door: { sill: 0, head: 2100 },
  window: { sill: 900, head: 2100 },
  open: { sill: 0, head: 99999 },
};
