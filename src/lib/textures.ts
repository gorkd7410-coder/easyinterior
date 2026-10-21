"use client";

import type { Material } from "./materials";

// 브랜드 실사 텍스처가 들어오기 전까지 쓰는 절차적 텍스처 (브라우저 캔버스로 생성).
// 같은 재질은 항상 같은 이미지가 나오도록 시드 고정 난수를 쓴다.

const SIZE = 512;
const cache = new Map<string, HTMLCanvasElement>();

function rng(seedStr: string) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) h = Math.imul(h ^ seedStr.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + amt * 255)));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `rgb(${r},${g},${b})`;
}

function noise(ctx: CanvasRenderingContext2D, rand: () => number, alpha: number, count = 6000) {
  for (let i = 0; i < count; i++) {
    const v = rand() > 0.5 ? 255 : 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha * rand()})`;
    ctx.fillRect(rand() * SIZE, rand() * SIZE, 1.5, 1.5);
  }
}

function drawWood(ctx: CanvasRenderingContext2D, m: Material, rand: () => number) {
  const plankH = ((m.unitW ?? 190) * SIZE) / m.tileH;
  const rows = Math.round(SIZE / plankH);
  const h = SIZE / rows;
  for (let r = 0; r < rows; r++) {
    // 판마다 엇갈린 이음매
    const offset = ((r * 0.37) % 1) * SIZE;
    const lens = [SIZE * 0.55, SIZE * 0.45];
    let x = -offset;
    let k = 0;
    while (x < SIZE) {
      const len = lens[k % 2];
      const tone = (rand() - 0.5) * 0.08;
      for (const xx of [x, x + SIZE]) {
        ctx.fillStyle = shade(m.color, tone);
        ctx.fillRect(xx, r * h, len, h);
        // 결
        ctx.strokeStyle = shade(m.accent, tone);
        ctx.globalAlpha = 0.35;
        for (let g = 0; g < 7; g++) {
          const y = r * h + rand() * h;
          ctx.lineWidth = 0.6 + rand() * 1.2;
          ctx.beginPath();
          ctx.moveTo(xx, y);
          ctx.bezierCurveTo(xx + len * 0.3, y + (rand() - 0.5) * 6, xx + len * 0.7, y + (rand() - 0.5) * 6, xx + len, y);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.fillRect(xx, r * h, 1.2, h);
      }
      x += len;
      k++;
    }
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fillRect(0, r * h, SIZE, 1.2);
  }
  noise(ctx, rand, 0.05);
}

function drawTile(ctx: CanvasRenderingContext2D, m: Material, rand: () => number) {
  const w = ((m.unitW ?? 600) / m.tileW) * SIZE;
  const h = ((m.unitH ?? 600) / m.tileH) * SIZE;
  ctx.fillStyle = m.accent;
  ctx.fillRect(0, 0, SIZE, SIZE);
  const grout = Math.max(1.5, SIZE / m.tileW * 3);
  for (let y = 0; y < SIZE; y += h) {
    for (let x = 0; x < SIZE; x += w) {
      ctx.fillStyle = shade(m.color, (rand() - 0.5) * 0.04);
      ctx.fillRect(x + grout / 2, y + grout / 2, w - grout, h - grout);
    }
  }
  noise(ctx, rand, 0.04);
}

function drawWallpaper(ctx: CanvasRenderingContext2D, m: Material, rand: () => number) {
  ctx.fillStyle = m.color;
  ctx.fillRect(0, 0, SIZE, SIZE);
  // 실크벽지 특유의 잔결
  ctx.strokeStyle = m.accent;
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 900; i++) {
    const x = rand() * SIZE;
    const y = rand() * SIZE;
    ctx.lineWidth = 0.5 + rand();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 8, y + 4 + rand() * 10);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  noise(ctx, rand, 0.03);
}

export function textureCanvas(m: Material): HTMLCanvasElement {
  const hit = cache.get(m.id);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext("2d")!;
  const rand = rng(m.id);
  if (m.pattern === "wood") drawWood(ctx, m, rand);
  else if (m.pattern === "tile") drawTile(ctx, m, rand);
  else if (m.pattern === "wallpaper") drawWallpaper(ctx, m, rand);
  else {
    ctx.fillStyle = m.color;
    ctx.fillRect(0, 0, SIZE, SIZE);
    noise(ctx, rand, 0.025);
  }
  cache.set(m.id, c);
  return c;
}

const urlCache = new Map<string, string>();
export function textureDataUrl(m: Material): string {
  const hit = urlCache.get(m.id);
  if (hit) return hit;
  const url = textureCanvas(m).toDataURL("image/png");
  urlCache.set(m.id, url);
  return url;
}

export async function texturePng(m: Material): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((res, rej) =>
    textureCanvas(m).toBlob((b) => (b ? res(b) : rej(new Error("PNG 생성 실패"))), "image/png"),
  );
  return new Uint8Array(await blob.arrayBuffer());
}
