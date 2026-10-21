"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { buildProject, type MeshPart } from "@/lib/build";
import { centroid } from "@/lib/geometry";
import { getMaterial } from "@/lib/materials";
import { textureCanvas } from "@/lib/textures";
import type { Project } from "@/lib/types";

export type CameraRequest = { mode: "overview" | "room"; roomId?: string; nonce: number };

type Props = {
  project: Project;
  cutaway: boolean;
  camera: CameraRequest;
  onSelectRoom: (id: string) => void;
};

const materialCache = new Map<string, THREE.MeshStandardMaterial>();
function threeMaterial(id: string) {
  const hit = materialCache.get(id);
  if (hit) return hit;
  const m = getMaterial(id);
  let mat: THREE.MeshStandardMaterial;
  if (m.category === "core") {
    mat = new THREE.MeshStandardMaterial({ color: m.color, roughness: m.roughness });
  } else {
    const tex = new THREE.CanvasTexture(textureCanvas(m));
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    mat = new THREE.MeshStandardMaterial({ map: tex, roughness: m.roughness });
  }
  materialCache.set(id, mat);
  return mat;
}

/** 모델 좌표(mm, Z-up) → three.js(m, Y-up) */
function toGeometry(part: MeshPart) {
  const n = part.positions.length / 3;
  const pos = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = part.positions[i * 3] / 1000;
    pos[i * 3 + 1] = part.positions[i * 3 + 2] / 1000;
    pos[i * 3 + 2] = -part.positions[i * 3 + 1] / 1000;
    nrm[i * 3] = part.normals[i * 3];
    nrm[i * 3 + 1] = part.normals[i * 3 + 2];
    nrm[i * 3 + 2] = -part.normals[i * 3 + 1];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(part.uvs), 2));
  return g;
}

function bounds(project: Project) {
  const pts = project.rooms.flatMap((r) => r.points);
  if (!pts.length) return { cx: 0, cz: 0, size: 10 };
  const s = project.mmPerPx / 1000;
  const xs = pts.map((p) => p.x * s);
  const zs = pts.map((p) => p.y * s);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, size: Math.max(maxX - minX, maxZ - minZ, 3) };
}

function CameraRig({ project, request, controlsRef }: { project: Project; request: CameraRequest; controlsRef: RefObject<OrbitControlsImpl | null> }) {
  const camera = useThree((s) => s.camera);
  const roomsKey = project.rooms.length;

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const s = project.mmPerPx / 1000;
    const room = request.mode === "room" ? project.rooms.find((r) => r.id === request.roomId) : undefined;
    if (room) {
      // 방 한가운데 눈높이에서 둘러보기
      const c = centroid(room.points);
      const target = new THREE.Vector3(c.x * s, 1.3, c.y * s);
      controls.target.copy(target);
      // 방 한가운데에서 한 걸음 뒤(남측)에 서서 북쪽을 바라보는 시점
      camera.position.set(target.x, 1.45, target.z + 0.6);
      controls.minDistance = 0.01;
    } else {
      const b = bounds(project);
      controls.target.set(b.cx, 0, b.cz);
      camera.position.set(b.cx + b.size * 0.15, b.size * 1.05, b.cz + b.size * 0.75);
      controls.minDistance = 1;
    }
    controls.update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.nonce, roomsKey]);
  return null;
}

export default function Viewer3D({ project, cutaway, camera, onSelectRoom }: Props) {
  const view = useMemo(() => (cutaway ? { ...project, wallHeight: 1100 } : project), [project, cutaway]);
  const meshes = useMemo(() => buildProject(view), [view]);
  const geometries = useMemo(
    () => meshes.map((m) => ({ roomId: m.roomId, parts: m.parts.map((p) => ({ id: p.materialId, geo: toGeometry(p) })) })),
    [meshes],
  );
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const prev = useRef(geometries);
  useEffect(() => {
    const old = prev.current;
    prev.current = geometries;
    if (old !== geometries) old.forEach((r) => r.parts.forEach((p) => p.geo.dispose()));
  }, [geometries]);

  return (
    <Canvas camera={{ fov: 55, near: 0.02, far: 500 }} dpr={[1, 2]}>
      <color attach="background" args={["#e8e6e1"]} />
      <hemisphereLight args={["#ffffff", "#b9b2a6", 1.1]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[8, 14, 10]} intensity={1.4} />
      <directionalLight position={[-6, 8, -4]} intensity={0.4} />
      <OrbitControls ref={controlsRef} makeDefault enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI * 0.495} />
      <CameraRig project={project} request={camera} controlsRef={controlsRef} />
      {geometries.map((r) => (
        <group
          key={r.roomId}
          onClick={(e) => {
            e.stopPropagation();
            onSelectRoom(r.roomId);
          }}
        >
          {r.parts.map((p) => (
            <mesh key={p.id} geometry={p.geo} material={threeMaterial(p.id)} />
          ))}
        </group>
      ))}
    </Canvas>
  );
}
