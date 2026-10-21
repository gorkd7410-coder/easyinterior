import type { RoomMesh } from "./build";
import { getMaterial } from "./materials";

// RoomMesh[] → Collada(.dae) 1.4.1 문자열.
// 스케치업 '파일 > 가져오기 > COLLADA'로 열면 방마다 하나의 그룹으로 들어오고,
// 마감재는 이름이 붙은 재질 + 텍스처로 들어와서 디자이너가 바로 교체할 수 있다.

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const num = (v: number, digits: number) => {
  const s = v.toFixed(digits);
  return s.includes(".") ? s.replace(/\.?0+$/, "") || "0" : s;
};

const hexToRgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => num(c / 255, 4)).join(" ");
};

export function texturePath(materialId: string) {
  return `textures/${materialId}.png`;
}

export function usedMaterialIds(meshes: RoomMesh[]): string[] {
  return [...new Set(meshes.flatMap((m) => m.parts.map((p) => p.materialId)))];
}

/** 텍스처 없이 색만 쓰는 재질 (벽체 단면 등) */
const isColorOnly = (id: string) => getMaterial(id).category === "core";

export function toCollada(meshes: RoomMesh[], title: string): string {
  const matIds = usedMaterialIds(meshes);
  const now = new Date().toISOString();
  const out: string[] = [];
  out.push(`<?xml version="1.0" encoding="utf-8"?>`);
  out.push(`<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">`);
  out.push(
    `<asset><contributor><authoring_tool>interior-mvp</authoring_tool></contributor>` +
      `<created>${now}</created><modified>${now}</modified>` +
      `<title>${esc(title)}</title>` +
      `<unit name="millimeter" meter="0.001"/><up_axis>Z_UP</up_axis></asset>`,
  );

  out.push(`<library_images>`);
  for (const id of matIds) {
    if (isColorOnly(id)) continue;
    out.push(`<image id="img-${id}" name="${id}"><init_from>${texturePath(id)}</init_from></image>`);
  }
  out.push(`</library_images>`);

  out.push(`<library_effects>`);
  for (const id of matIds) {
    const m = getMaterial(id);
    out.push(`<effect id="fx-${id}"><profile_COMMON>`);
    if (isColorOnly(id)) {
      // 유리는 반투명 (A_ONE: 불투명도 = 색의 알파 × transparency)
      const glass = id === "glass" ? `<transparent opaque="A_ONE"><color>1 1 1 0.35</color></transparent><transparency><float>1</float></transparency>` : "";
      out.push(
        `<technique sid="common"><lambert><diffuse><color>${hexToRgb(m.color)} 1</color></diffuse>${glass}</lambert></technique>`,
      );
    } else {
      out.push(
        `<newparam sid="surf-${id}"><surface type="2D"><init_from>img-${id}</init_from></surface></newparam>` +
          `<newparam sid="samp-${id}"><sampler2D><source>surf-${id}</source></sampler2D></newparam>` +
          `<technique sid="common"><lambert><diffuse><texture texture="samp-${id}" texcoord="UVSET0"/></diffuse></lambert></technique>`,
      );
    }
    out.push(`</profile_COMMON></effect>`);
  }
  out.push(`</library_effects>`);

  out.push(`<library_materials>`);
  for (const id of matIds) {
    out.push(`<material id="mat-${id}" name="${esc(getMaterial(id).name)}"><instance_effect url="#fx-${id}"/></material>`);
  }
  out.push(`</library_materials>`);

  out.push(`<library_geometries>`);
  meshes.forEach((room, ri) => {
    if (room.parts.length === 0) return;
    const gid = `geo-${ri}`;
    // 위치는 중복 제거(스케치업에서 면이 깔끔하게 붙도록), 법선/UV는 삼각형 꼭짓점별
    const posIndex = new Map<string, number>();
    const pos: string[] = [];
    const nrm: string[] = [];
    const uv: string[] = [];
    const tris: { mat: string; idx: number[] }[] = [];
    let corner = 0;
    for (const part of room.parts) {
      const idx: number[] = [];
      for (let v = 0; v < part.positions.length / 3; v++) {
        const x = num(part.positions[v * 3], 2);
        const y = num(part.positions[v * 3 + 1], 2);
        const z = num(part.positions[v * 3 + 2], 2);
        const key = `${x} ${y} ${z}`;
        let pi = posIndex.get(key);
        if (pi === undefined) {
          pi = posIndex.size;
          posIndex.set(key, pi);
          pos.push(key);
        }
        nrm.push(
          `${num(part.normals[v * 3], 5)} ${num(part.normals[v * 3 + 1], 5)} ${num(part.normals[v * 3 + 2], 5)}`,
        );
        uv.push(`${num(part.uvs[v * 2], 5)} ${num(part.uvs[v * 2 + 1], 5)}`);
        idx.push(pi, corner, corner);
        corner++;
      }
      tris.push({ mat: part.materialId, idx });
    }
    const src = (id: string, data: string[], stride: number, params: string[]) =>
      `<source id="${gid}-${id}"><float_array id="${gid}-${id}-arr" count="${data.length * stride}">${data.join(" ")}</float_array>` +
      `<technique_common><accessor source="#${gid}-${id}-arr" count="${data.length}" stride="${stride}">` +
      params.map((p) => `<param name="${p}" type="float"/>`).join("") +
      `</accessor></technique_common></source>`;

    out.push(`<geometry id="${gid}" name="${esc(room.name)}"><mesh>`);
    out.push(src("pos", pos, 3, ["X", "Y", "Z"]));
    out.push(src("nrm", nrm, 3, ["X", "Y", "Z"]));
    out.push(src("uv", uv, 2, ["S", "T"]));
    out.push(`<vertices id="${gid}-vtx"><input semantic="POSITION" source="#${gid}-pos"/></vertices>`);
    for (const t of tris) {
      out.push(
        `<triangles material="sym-${t.mat}" count="${t.idx.length / 9}">` +
          `<input semantic="VERTEX" source="#${gid}-vtx" offset="0"/>` +
          `<input semantic="NORMAL" source="#${gid}-nrm" offset="1"/>` +
          `<input semantic="TEXCOORD" source="#${gid}-uv" offset="2" set="0"/>` +
          `<p>${t.idx.join(" ")}</p></triangles>`,
      );
    }
    out.push(`</mesh></geometry>`);
  });
  out.push(`</library_geometries>`);

  // 스케치업 원점이 도면 왼쪽 아래(남서) 모서리에 오도록 이동
  let minX = Infinity;
  let minY = Infinity;
  for (const room of meshes)
    for (const part of room.parts)
      for (let i = 0; i < part.positions.length; i += 3) {
        minX = Math.min(minX, part.positions[i]);
        minY = Math.min(minY, part.positions[i + 1]);
      }
  const shift = Number.isFinite(minX) ? `${num(-minX, 2)} ${num(-minY, 2)} 0` : "0 0 0";

  out.push(`<library_visual_scenes><visual_scene id="scene" name="${esc(title)}">`);
  meshes.forEach((room, ri) => {
    if (room.parts.length === 0) return;
    out.push(`<node id="room-${ri}" name="${esc(room.name)}"><translate>${shift}</translate><instance_geometry url="#geo-${ri}"><bind_material><technique_common>`);
    for (const id of new Set(room.parts.map((p) => p.materialId))) {
      out.push(
        `<instance_material symbol="sym-${id}" target="#mat-${id}">` +
          `<bind_vertex_input semantic="UVSET0" input_semantic="TEXCOORD" input_set="0"/></instance_material>`,
      );
    }
    out.push(`</technique_common></bind_material></instance_geometry></node>`);
  });
  out.push(`</visual_scene></library_visual_scenes>`);
  out.push(`<scene><instance_visual_scene url="#scene"/></scene>`);
  out.push(`</COLLADA>`);
  return out.join("\n");
}
