import type { RoomType } from "./types";

// 브랜드 제휴 전까지 쓰는 샘플 마감재. 추후 브랜드/품번/실사 텍스처로 교체한다.
// tileW/tileH: 텍스처 한 장이 덮는 실제 크기(mm)

export type MaterialPattern = "wood" | "tile" | "wallpaper" | "plain";

export type Material = {
  id: string;
  name: string;
  category: "floor" | "wall" | "core";
  pattern: MaterialPattern;
  color: string;
  accent: string; // 결/줄눈/무늬 색
  tileW: number;
  tileH: number;
  roughness: number;
  // 타일: 한 장 크기(mm), 마루: 판 폭(mm)
  unitW?: number;
  unitH?: number;
  note?: string;
};

export const MATERIALS: Material[] = [
  // 바닥
  { id: "floor_oak_natural", name: "강마루 내추럴 오크", category: "floor", pattern: "wood", color: "#c9a27a", accent: "#a97f57", tileW: 1200, tileH: 760, unitW: 190, roughness: 0.55 },
  { id: "floor_oak_gray", name: "강마루 그레이 오크", category: "floor", pattern: "wood", color: "#b8b0a5", accent: "#958c80", tileW: 1200, tileH: 760, unitW: 190, roughness: 0.55 },
  { id: "floor_oak_white", name: "강마루 화이트 오크", category: "floor", pattern: "wood", color: "#e2d5c3", accent: "#c8b59c", tileW: 1200, tileH: 760, unitW: 190, roughness: 0.55 },
  { id: "floor_walnut", name: "강마루 월넛", category: "floor", pattern: "wood", color: "#7a5236", accent: "#5a3a24", tileW: 1200, tileH: 760, unitW: 190, roughness: 0.5 },
  { id: "floor_tile_white_600", name: "포세린 타일 화이트 600각", category: "floor", pattern: "tile", color: "#ecebe7", accent: "#c9c7c1", tileW: 1200, tileH: 1200, unitW: 600, unitH: 600, roughness: 0.25 },
  { id: "floor_tile_gray_6001200", name: "포세린 타일 그레이 600×1200", category: "floor", pattern: "tile", color: "#a9a7a2", accent: "#8a8883", tileW: 1200, tileH: 1200, unitW: 1200, unitH: 600, roughness: 0.3 },
  { id: "floor_tile_bath_300", name: "욕실 바닥타일 그레이 300각", category: "floor", pattern: "tile", color: "#8f8f8c", accent: "#6e6e6b", tileW: 1200, tileH: 1200, unitW: 300, unitH: 300, roughness: 0.6 },
  { id: "floor_vinyl_beige", name: "장판 베이지", category: "floor", pattern: "plain", color: "#d6c3a3", accent: "#c4af8c", tileW: 1000, tileH: 1000, roughness: 0.7 },

  // 벽
  { id: "wall_silk_white", name: "실크벽지 화이트", category: "wall", pattern: "wallpaper", color: "#f3f2ee", accent: "#e6e4de", tileW: 1000, tileH: 1000, roughness: 0.8 },
  { id: "wall_silk_warmgray", name: "실크벽지 웜그레이", category: "wall", pattern: "wallpaper", color: "#cfcac2", accent: "#bfb9af", tileW: 1000, tileH: 1000, roughness: 0.8 },
  { id: "wall_silk_beige", name: "실크벽지 베이지", category: "wall", pattern: "wallpaper", color: "#e6dac6", accent: "#d6c8b1", tileW: 1000, tileH: 1000, roughness: 0.8 },
  { id: "wall_paper_ivory", name: "합지벽지 아이보리", category: "wall", pattern: "wallpaper", color: "#f1ead9", accent: "#e4dbc6", tileW: 1000, tileH: 1000, roughness: 0.9 },
  { id: "wall_point_sage", name: "포인트 세이지그린", category: "wall", pattern: "plain", color: "#a7b39c", accent: "#97a38c", tileW: 1000, tileH: 1000, roughness: 0.85 },
  { id: "wall_point_navy", name: "포인트 네이비", category: "wall", pattern: "plain", color: "#3b4a63", accent: "#323f55", tileW: 1000, tileH: 1000, roughness: 0.85 },
  { id: "wall_tile_white_300600", name: "벽타일 화이트 300×600", category: "wall", pattern: "tile", color: "#f2f2f0", accent: "#d2d2cf", tileW: 1200, tileH: 1200, unitW: 600, unitH: 300, roughness: 0.2 },
  { id: "wall_tile_gray_300600", name: "벽타일 그레이 300×600", category: "wall", pattern: "tile", color: "#b5b4b0", accent: "#93928e", tileW: 1200, tileH: 1200, unitW: 600, unitH: 300, roughness: 0.3 },

  // 벽체 단면/외부 (편집 대상 아님)
  { id: "core", name: "벽체", category: "core", pattern: "plain", color: "#e9e7e2", accent: "#e9e7e2", tileW: 1000, tileH: 1000, roughness: 0.9 },
  { id: "glass", name: "유리", category: "core", pattern: "plain", color: "#cfe3ec", accent: "#cfe3ec", tileW: 1000, tileH: 1000, roughness: 0.05 },
  { id: "steel", name: "스테인리스", category: "core", pattern: "plain", color: "#b9bdc1", accent: "#b9bdc1", tileW: 1000, tileH: 1000, roughness: 0.3 },
  { id: "porcelain", name: "도기 (백색)", category: "core", pattern: "plain", color: "#f7f7f5", accent: "#f7f7f5", tileW: 1000, tileH: 1000, roughness: 0.15 },
  { id: "stone", name: "인조대리석 상판", category: "core", pattern: "plain", color: "#e7e3dc", accent: "#e7e3dc", tileW: 1000, tileH: 1000, roughness: 0.3 },
  { id: "mirror", name: "거울", category: "core", pattern: "plain", color: "#d3dde2", accent: "#d3dde2", tileW: 1000, tileH: 1000, roughness: 0.05 },
];

export const MATERIAL_BY_ID: Record<string, Material> = Object.fromEntries(
  MATERIALS.map((m) => [m.id, m]),
);

/** 문·창호·설비 색 (도장/필름 색) */
export const PAINT_COLORS: { name: string; hex: string }[] = [
  { name: "화이트", hex: "#f4f4f1" },
  { name: "아이보리", hex: "#ece3cf" },
  { name: "라이트그레이", hex: "#c8c8c4" },
  { name: "다크그레이", hex: "#4a4c50" },
  { name: "블랙", hex: "#202124" },
  { name: "오크", hex: "#b88a5a" },
  { name: "월넛", hex: "#6b4a33" },
  { name: "세이지", hex: "#a3ae98" },
  { name: "실버", hex: "#a9adb1" },
];

const paintName = (hex: string) => PAINT_COLORS.find((c) => c.hex === hex)?.name ?? hex;

const dynamic = new Map<string, Material>();

/** "paint:#rrggbb" 은 색만 있는 도장 재질, "glass" 는 유리 */
export const paint = (hex: string) => `paint:${hex}`;

export const getMaterial = (id: string): Material => {
  const hit = MATERIAL_BY_ID[id] ?? dynamic.get(id);
  if (hit) return hit;
  if (id.startsWith("paint:#")) {
    const hex = id.slice(6);
    const m: Material = { id, name: `도장 ${paintName(hex)}`, category: "core", pattern: "plain", color: hex, accent: hex, tileW: 1000, tileH: 1000, roughness: 0.5 };
    dynamic.set(id, m);
    return m;
  }
  return MATERIAL_BY_ID.core;
};

type RoomFinish = { floor: string; wall: string };

export type Preset = {
  id: string;
  name: string;
  description: string;
  byType: Record<RoomType, RoomFinish>;
};

const wetAreas = (floor: string, wall: string): Pick<Preset["byType"], "bath"> => ({
  bath: { floor, wall },
});

export const PRESETS: Preset[] = [
  {
    id: "modern_white",
    name: "모던 화이트",
    description: "그레이 오크 + 화이트 실크, 무난한 신축 느낌",
    byType: {
      living: { floor: "floor_oak_gray", wall: "wall_silk_white" },
      bedroom: { floor: "floor_oak_gray", wall: "wall_silk_white" },
      kitchen: { floor: "floor_oak_gray", wall: "wall_silk_white" },
      entry: { floor: "floor_tile_gray_6001200", wall: "wall_silk_white" },
      balcony: { floor: "floor_tile_gray_6001200", wall: "wall_silk_white" },
      etc: { floor: "floor_oak_gray", wall: "wall_silk_white" },
      ...wetAreas("floor_tile_bath_300", "wall_tile_white_300600"),
    },
  },
  {
    id: "natural_wood",
    name: "내추럴 우드",
    description: "내추럴 오크 + 아이보리, 따뜻한 원목 톤",
    byType: {
      living: { floor: "floor_oak_natural", wall: "wall_paper_ivory" },
      bedroom: { floor: "floor_oak_natural", wall: "wall_paper_ivory" },
      kitchen: { floor: "floor_oak_natural", wall: "wall_paper_ivory" },
      entry: { floor: "floor_tile_white_600", wall: "wall_paper_ivory" },
      balcony: { floor: "floor_tile_white_600", wall: "wall_paper_ivory" },
      etc: { floor: "floor_oak_natural", wall: "wall_paper_ivory" },
      ...wetAreas("floor_tile_bath_300", "wall_tile_white_300600"),
    },
  },
  {
    id: "warm_beige",
    name: "웜 베이지",
    description: "화이트 오크 + 베이지 실크, 밝고 포근한 조합",
    byType: {
      living: { floor: "floor_oak_white", wall: "wall_silk_beige" },
      bedroom: { floor: "floor_oak_white", wall: "wall_silk_beige" },
      kitchen: { floor: "floor_oak_white", wall: "wall_silk_white" },
      entry: { floor: "floor_tile_white_600", wall: "wall_silk_beige" },
      balcony: { floor: "floor_tile_white_600", wall: "wall_silk_beige" },
      etc: { floor: "floor_oak_white", wall: "wall_silk_beige" },
      ...wetAreas("floor_tile_bath_300", "wall_tile_gray_300600"),
    },
  },
  {
    id: "tile_hotel",
    name: "호텔식 타일",
    description: "거실 포세린 타일 + 웜그레이, 깔끔하고 고급스러운 톤",
    byType: {
      living: { floor: "floor_tile_white_600", wall: "wall_silk_warmgray" },
      bedroom: { floor: "floor_oak_gray", wall: "wall_silk_warmgray" },
      kitchen: { floor: "floor_tile_white_600", wall: "wall_silk_white" },
      entry: { floor: "floor_tile_gray_6001200", wall: "wall_silk_warmgray" },
      balcony: { floor: "floor_tile_gray_6001200", wall: "wall_silk_white" },
      etc: { floor: "floor_oak_gray", wall: "wall_silk_warmgray" },
      ...wetAreas("floor_tile_bath_300", "wall_tile_gray_300600"),
    },
  },
  {
    id: "dark_chic",
    name: "다크 시크",
    description: "월넛 + 웜그레이, 묵직하고 차분한 분위기",
    byType: {
      living: { floor: "floor_walnut", wall: "wall_silk_warmgray" },
      bedroom: { floor: "floor_walnut", wall: "wall_silk_warmgray" },
      kitchen: { floor: "floor_walnut", wall: "wall_silk_white" },
      entry: { floor: "floor_tile_gray_6001200", wall: "wall_silk_warmgray" },
      balcony: { floor: "floor_tile_gray_6001200", wall: "wall_silk_white" },
      etc: { floor: "floor_walnut", wall: "wall_silk_warmgray" },
      ...wetAreas("floor_tile_bath_300", "wall_tile_gray_300600"),
    },
  },
];

export const DEFAULT_PRESET = PRESETS[0];

export function finishFor(type: RoomType, preset: Preset = DEFAULT_PRESET): RoomFinish {
  return preset.byType[type];
}
