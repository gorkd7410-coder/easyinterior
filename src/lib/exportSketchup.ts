"use client";

import { buildProject } from "./build";
import { texturePath, toCollada, usedMaterialIds } from "./collada";
import { getMaterial } from "./materials";
import { texturePng } from "./textures";
import type { Project } from "./types";
import { makeZip, type ZipEntry } from "./zip";

const README = `스케치업에서 여는 방법
1. 이 압축파일을 풀어주세요 (textures 폴더를 .dae 파일과 같은 위치에 두어야 합니다).
2. SketchUp > 파일 > 가져오기 > 파일 형식 "COLLADA 파일 (*.dae)" 선택 > .dae 파일 열기
   (가져오기 옵션에서 '동일 평면 면 병합'을 켜면 면이 더 깔끔해집니다)
3. 방마다 그룹으로 들어오고, 마감재는 이름 붙은 재질로 들어옵니다.
   재질 패널에서 원하는 실제 자재로 교체해서 쓰시면 됩니다.

단위: mm / 기준: 벽 중심선. 상담용 추정 골조이므로 시공 전 실측 확인이 필요합니다.
project.json 은 웹 편집기에서 다시 불러올 수 있는 원본 파일입니다.
`;

/** 한글 파일명은 브라우저에 따라 "download"로 바뀌는 경우가 있어 다운로드 파일명은 영문+날짜로 */
export function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]/g, "_").trim() || "project";

export async function exportSketchupZip(project: Project): Promise<{ blob: Blob; filename: string }> {
  const meshes = buildProject(project);
  const base = safeName(project.name);
  const enc = new TextEncoder();
  const entries: ZipEntry[] = [
    { name: `${base}.dae`, data: enc.encode(toCollada(meshes, project.name)) },
    { name: "README.txt", data: enc.encode(README) },
    { name: "project.json", data: enc.encode(JSON.stringify(project)) },
  ];
  for (const id of usedMaterialIds(meshes)) {
    const m = getMaterial(id);
    if (m.category === "core") continue;
    entries.push({ name: texturePath(id), data: await texturePng(m) });
  }
  return { blob: makeZip(entries), filename: `sketchup_${stamp()}.zip` };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
