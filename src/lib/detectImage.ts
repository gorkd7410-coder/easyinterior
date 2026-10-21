"use client";

import { detectRooms, type DetectResult } from "./detect";
import { traceWalls, type TracedPlan } from "./traceWalls";

// 평면도 이미지(dataURL) → 픽셀 → 방 인식. 같은 이미지·강도는 다시 계산하지 않는다.

let cacheKey = "";
let cacheResult: DetectResult | null = null;

function loadPixels(dataUrl: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, c.width, c.height));
    };
    img.onerror = () => reject(new Error("이미지를 읽을 수 없습니다"));
    img.src = dataUrl;
  });
}

export async function detectFromDataUrl(dataUrl: string, gapStrength: number): Promise<DetectResult> {
  const key = `${dataUrl.length}:${dataUrl.slice(-64)}:${gapStrength}`;
  if (key === cacheKey && cacheResult) return cacheResult;
  const pixels = await loadPixels(dataUrl);
  // 계산 전에 화면이 '인식 중' 상태를 그릴 틈을 준다
  await new Promise((r) => setTimeout(r, 0));
  const result = detectRooms(pixels, { gapStrength });
  cacheKey = key;
  cacheResult = result;
  return result;
}

let pixelKey = "";
let pixelCache: ImageData | null = null;

export async function traceFromDataUrl(dataUrl: string, gapStrength: number): Promise<TracedPlan> {
  const key = `${dataUrl.length}:${dataUrl.slice(-64)}`;
  if (key !== pixelKey || !pixelCache) {
    pixelCache = await loadPixels(dataUrl);
    pixelKey = key;
  }
  await new Promise((r) => setTimeout(r, 0));
  return traceWalls(pixelCache, { gapStrength });
}
