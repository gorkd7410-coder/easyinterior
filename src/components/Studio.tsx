"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { detectFromDataUrl, traceFromDataUrl } from "@/lib/detectImage";
import { downloadBlob, exportSketchupZip, stamp } from "@/lib/exportSketchup";
import { pointInPolygon, polygonArea, uid } from "@/lib/geometry";
import { MATERIALS, PAINT_COLORS, PRESETS, finishFor, getMaterial, type Material } from "@/lib/materials";
import { FIT_DEFAULTS, ITEM_SPECS, autoFixtures, placeItem } from "@/lib/fixtures";
import { fitScaleToArea, loadSaved, roomAreaM2, save, totalAreaM2 } from "@/lib/project";
import { TEMPLATES, emptyProject, projectFromTemplate } from "@/lib/templates";
import { textureDataUrl } from "@/lib/textures";
import type { Fit, FitType, InfillKind, Item, ItemType, Opening, OpeningKind, Project, Pt, Room, RoomType, TracedWalls } from "@/lib/types";
import { FIT_LABEL, INFILL_LABEL, OPENING_DEFAULTS, OPENING_LABEL, ROOM_TYPE_LABEL } from "@/lib/types";
import DraftPanel from "./DraftPanel";
import PlanEditor, { type Selection, type Tool } from "./PlanEditor";
import type { CameraRequest } from "./Viewer3D";

const Viewer3D = dynamic(() => import("./Viewer3D"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-neutral-500">3D 준비 중…</div>,
});

const TOOLS: { id: Tool; label: string; key: string; hint: string }[] = [
  { id: "select", label: "선택", key: "V", hint: "방/문을 클릭해 선택 · 꼭짓점 드래그로 수정 · 빈 곳 드래그로 화면 이동 · 휠로 확대" },
  { id: "room", label: "방 그리기", key: "R", hint: "벽 중심선을 따라 꼭짓점 클릭 · 첫 점 클릭 또는 Enter로 완성 · Shift로 직각 스냅 끄기 · Backspace 한 점 취소" },
  { id: "door", label: "문", key: "D", hint: "벽 위에서 문 시작점과 끝점을 클릭" },
  { id: "window", label: "창", key: "W", hint: "벽 위에서 창 시작점과 끝점을 클릭" },
  { id: "open", label: "개구부", key: "O", hint: "벽을 없앨 구간(거실-주방 등)의 시작점과 끝점을 클릭" },
  { id: "pick", label: "방 클릭 인식", key: "A", hint: "평면도 이미지에서 방 안쪽을 클릭하면 벽을 따라 방 모양을 자동으로 잡습니다 (평면도 이미지가 있을 때)" },
  { id: "scale", label: "축척 맞추기", key: "S", hint: "치수를 아는 두 점(예: 평면도 치수선 양끝)을 클릭하면 실제 길이를 입력합니다" },
];

type History = { past: Project[]; present: Project; future: Project[] };

export default function Studio() {
  const [hist, setHist] = useState<History>(() => ({ past: [], present: loadSaved() ?? projectFromTemplate(TEMPLATES[1]), future: [] }));
  const project = hist.present;
  const [tool, setTool] = useState<Tool>("select");
  const [selection, setSelection] = useState<Selection>(null);
  const [view, setView] = useState<"split" | "plan" | "3d">("split");
  const [cutaway, setCutaway] = useState(false);
  const [camera, setCamera] = useState<CameraRequest>({ mode: "overview", nonce: 0 });
  const [exporting, setExporting] = useState(false);
  const [areaInput, setAreaInput] = useState("");
  const [gapStrength, setGapStrength] = useState(1);
  const [detecting, setDetecting] = useState(false);
  const [detectMsg, setDetectMsg] = useState("");
  const [draftOpen, setDraftOpen] = useState(false);
  const [placeType, setPlaceType] = useState<ItemType>("sink");
  const [fitColors, setFitColors] = useState({ frame: "#f4f4f1", leaf: "#f4f4f1" });
  const captureRef = useRef<(() => string) | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const jsonRef = useRef<HTMLInputElement>(null);

  const update = useCallback((next: Project, commit = true) => {
    setHist((h) =>
      commit ? { past: [...h.past.slice(-80), h.present], present: next, future: [] } : { ...h, present: next },
    );
  }, []);
  const patch = (p: Partial<Project>) => update({ ...project, ...p });
  const undo = () => setHist((h) => (h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h));
  const redo = () => setHist((h) => (h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h));

  // 자동 저장
  useEffect(() => {
    const t = setTimeout(() => save(project), 400);
    return () => clearTimeout(t);
  }, [project]);

  const selectedRoom = selection?.kind === "room" ? project.rooms.find((r) => r.id === selection.id) : undefined;
  const selectedOpening = selection?.kind === "opening" ? project.openings.find((o) => o.id === selection.id) : undefined;

  const updateRoom = (id: string, p: Partial<Room>) =>
    update({ ...project, rooms: project.rooms.map((r) => (r.id === id ? { ...r, ...p } : r)) });
  const updateOpening = (id: string, p: Partial<Opening>) =>
    update({ ...project, openings: project.openings.map((o) => (o.id === id ? { ...o, ...p } : o)) });
  const selectedInfill = selection?.kind === "infill" ? project.traced?.infills.find((f) => f.id === selection.id) : undefined;
  const updateTraced = (p: Partial<TracedWalls>) => project.traced && update({ ...project, traced: { ...project.traced, ...p } });
  const selectedItem = selection?.kind === "item" ? project.items?.find((x) => x.id === selection.id) : undefined;
  const updateItem = (id: string, p: Partial<Item>) =>
    update({ ...project, items: (project.items ?? []).map((x) => (x.id === id ? { ...x, ...p } : x)) });
  const setInfillFit = (id: string, fit: Fit | undefined) =>
    updateTraced({ infills: project.traced!.infills.map((f) => (f.id === id ? { ...f, fit } : f)) });

  /** 문 자리 전부에 문짝, 또는 창 자리 전부에 샷시 */
  const fitAll = (what: "door" | "sash") => {
    const fit: Fit = { ...FIT_DEFAULTS[what], ...fitColors, type: what };
    const want = (isWindow: boolean) => (what === "sash" ? isWindow : !isWindow);
    update({
      ...project,
      // 현관문으로 바꿔둔 자리는 그대로 둔다
      openings: project.openings.map((o) => (o.kind !== "open" && want(o.kind === "window") && o.fit?.type !== "entry" ? { ...o, fit } : o)),
      traced: project.traced
        ? { ...project.traced, infills: project.traced.infills.map((f) => (want(f.kind !== "door") && f.fit?.type !== "entry" ? { ...f, fit } : f)) }
        : project.traced,
    });
  };

  const onPlace = (p: Pt) => {
    const item = placeItem(project, placeType, p);
    update({ ...project, items: [...(project.items ?? []), item] });
    setSelection({ kind: "item", id: item.id });
    setTool("select");
  };

  const deleteSelection = () => {
    if (!selection) return;
    if (selection.kind === "room") update({ ...project, rooms: project.rooms.filter((r) => r.id !== selection.id) });
    else if (selection.kind === "infill") updateTraced({ infills: project.traced!.infills.filter((f) => f.id !== selection.id) });
    else if (selection.kind === "item") update({ ...project, items: (project.items ?? []).filter((x) => x.id !== selection.id) });
    else update({ ...project, openings: project.openings.filter((o) => o.id !== selection.id) });
    setSelection(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea,select")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (mod) return;
      if (e.key === "Delete") deleteSelection();
      const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
      if (t) setTool(t.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const startFrom = (p: Project) => {
    update(p);
    setSelection(null);
    setTool(p.rooms.length ? "select" : "room");
    setCamera((c) => ({ mode: "overview", nonce: c.nonce + 1 }));
  };

  const onImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onload = () => {
        // 축척 초기값: 이미지 가로를 대략 15m로 가정 (이후 축척 맞추기로 보정)
        const base = emptyProject();
        startFrom({
          ...base,
          name: file.name.replace(/\.[^.]+$/, ""),
          image: { dataUrl, width: img.naturalWidth, height: img.naturalHeight },
          mmPerPx: 15000 / img.naturalWidth,
        });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  /** 이미지를 처음 올린 뒤 축척을 아직 안 맞췄으면 인식한 벽 두께로 축척을 추정 */
  const scaleUntouched = (p: Project) => !!p.image && Math.abs(p.mmPerPx - 15000 / p.image.width) < 1e-9;

  const makeRoom = (points: Pt[], name: string, type: RoomType): Room => {
    const f = finishFor(type);
    return { id: uid(), name, type, points, floorMat: f.floor, wallMat: f.wall };
  };

  /** 평면도의 검은 벽을 그대로 따서 3D로 세우고, 벽으로 둘러싸인 공간은 방 바닥으로 */
  const traceAll = async () => {
    if (!project.image) return;
    if ((project.rooms.length || project.traced) && !window.confirm("지금 도면을 지우고 평면도에서 벽을 새로 딸까요?")) return;
    setDetecting(true);
    setDetectMsg("");
    try {
      const res = await traceFromDataUrl(project.image.dataUrl, gapStrength);
      const mmPerPx = scaleUntouched(project) ? res.mmPerPxGuess : project.mmPerPx;
      const sorted = [...res.regions].sort((a, b) => polygonArea(b) - polygonArea(a));
      let n = 0;
      let m = 0;
      const rooms = sorted.map((pts, i) => {
        const m2 = (polygonArea(pts) * mmPerPx * mmPerPx) / 1e6;
        const room = i === 0 ? makeRoom(pts, "거실", "living") : m2 >= 6.5 ? makeRoom(pts, `방${++n}`, "bedroom") : makeRoom(pts, `공간${++m}`, "etc");
        return { ...room, floorOnly: true };
      });
      const traced: TracedWalls = {
        walls: res.walls,
        infills: res.infills.map((f) => ({ id: uid(), poly: f.poly, kind: f.kind === "door" ? "door" : f.floorLevel ? "floorWindow" : "window" })),
        slab: res.slab,
        wallMat: project.traced?.wallMat ?? "wall_silk_white",
      };
      update({ ...project, rooms, openings: [], traced, mmPerPx });
      setSelection(null);
      setTool("select");
      setCamera((c) => ({ mode: "overview", nonce: c.nonce + 1 }));
      setDetectMsg(
        res.walls.length
          ? `벽 ${res.walls.length}덩어리, 문·창 ${traced.infills.length}곳, 방 ${rooms.length}개를 땄습니다. 전용면적을 입력해 축척을 맞추고, 틀린 문·창은 클릭해서 고치거나 지우세요.`
          : "벽을 찾지 못했습니다. 벽이 검게 그려진 평면도인지 확인해주세요.",
      );
    } catch (e) {
      setDetectMsg(`인식 실패: ${(e as Error).message}`);
    } finally {
      setDetecting(false);
    }
  };

  const detectAll = async () => {
    if (!project.image) return;
    if (project.rooms.length && !window.confirm("그려둔 방을 지우고 자동 인식 결과로 바꿀까요?")) return;
    setDetecting(true);
    setDetectMsg("");
    try {
      const res = await detectFromDataUrl(project.image.dataUrl, gapStrength);
      const mmPerPx = scaleUntouched(project) ? res.mmPerPxGuess : project.mmPerPx;
      // 넓은 순으로 이름 붙이기 (가장 넓은 곳 = 거실)
      const sorted = [...res.rooms].sort((a, b) => polygonArea(b) - polygonArea(a));
      let n = 0;
      let m = 0;
      const rooms = sorted.map((pts, i) => {
        const m2 = (polygonArea(pts) * mmPerPx * mmPerPx) / 1e6;
        if (i === 0) return makeRoom(pts, "거실", "living");
        if (m2 >= 6.5) return makeRoom(pts, `방${++n}`, "bedroom");
        return makeRoom(pts, `공간${++m}`, "etc");
      });
      update({ ...project, rooms, openings: [], traced: null, mmPerPx });
      setSelection(null);
      setTool("select");
      setCamera((c) => ({ mode: "overview", nonce: c.nonce + 1 }));
      setDetectMsg(
        rooms.length
          ? `방 ${rooms.length}개를 찾았습니다. 이름·용도를 고치고, 전용면적을 입력해 축척을 맞춰주세요. 문·창은 직접 추가합니다.`
          : "방을 찾지 못했습니다. '문틈 막기'를 올려보거나 '방 클릭 인식'을 써보세요.",
      );
    } catch (e) {
      setDetectMsg(`인식 실패: ${(e as Error).message}`);
    } finally {
      setDetecting(false);
    }
  };

  const onPick = async (p: Pt) => {
    if (!project.image) {
      setDetectMsg("평면도 이미지를 먼저 올려주세요.");
      return;
    }
    if (project.rooms.some((r) => pointInPolygon(p, r.points))) {
      setDetectMsg("이미 방이 있는 자리입니다.");
      return;
    }
    setDetecting(true);
    try {
      const res = await detectFromDataUrl(project.image.dataUrl, gapStrength);
      const idx = res.roomAt(p);
      if (idx < 0) {
        setDetectMsg("이 자리에서는 방 모양을 찾지 못했습니다. '문틈 막기'를 바꿔보거나 직접 그려주세요.");
        return;
      }
      const pts = res.rooms[idx];
      const mmPerPx = scaleUntouched(project) ? res.mmPerPxGuess : project.mmPerPx;
      const room = makeRoom(pts, `방${project.rooms.length + 1}`, "bedroom");
      update({ ...project, rooms: [...project.rooms, room], mmPerPx });
      setSelection({ kind: "room", id: room.id });
      setDetectMsg(`'${room.name}'을(를) 추가했습니다. 다른 방도 계속 클릭해서 추가할 수 있습니다.`);
    } catch (e) {
      setDetectMsg(`인식 실패: ${(e as Error).message}`);
    } finally {
      setDetecting(false);
    }
  };

  const onScaleMeasured = (px: number) => {
    const v = window.prompt("두 점 사이의 실제 길이를 mm로 입력하세요 (예: 3600)");
    const mm = Number(v);
    if (!v || !Number.isFinite(mm) || mm <= 0 || px <= 0) return;
    patch({ mmPerPx: mm / px });
  };

  const applyPreset = (presetId: string) => {
    const preset = PRESETS.find((p) => p.id === presetId)!;
    update({
      ...project,
      rooms: project.rooms.map((r) => ({ ...r, floorMat: preset.byType[r.type].floor, wallMat: preset.byType[r.type].wall })),
      traced: project.traced ? { ...project.traced, wallMat: preset.byType.living.wall } : project.traced,
    });
  };

  const doExport = async () => {
    setExporting(true);
    try {
      const { blob, filename } = await exportSketchupZip(project);
      downloadBlob(blob, filename);
    } catch (e) {
      alert(`내보내기 실패: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  const onLoadJson = async (file: File) => {
    try {
      const p = JSON.parse(await file.text()) as Project;
      if (p.version !== 1 || !Array.isArray(p.rooms)) throw new Error("형식이 맞지 않습니다");
      startFrom(p);
    } catch (e) {
      alert(`불러오기 실패: ${(e as Error).message}`);
    }
  };

  const hint =
    tool === "item"
      ? `${ITEM_SPECS[placeType].label}: 놓을 자리를 클릭하면 가까운 벽에 등을 대고 놓입니다. 놓은 뒤 끌어서 옮기세요.`
      : TOOLS.find((t) => t.id === tool)!.hint;

  return (
    <div className="flex h-dvh flex-col bg-white text-neutral-900">
      {/* 상단 바 */}
      <header className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-3 py-2">
        <span className="mr-1 font-bold">실측없이</span>
        <input
          className="w-48 rounded border border-neutral-300 px-2 py-1 text-sm"
          value={project.name}
          onChange={(e) => update({ ...project, name: e.target.value }, false)}
          aria-label="프로젝트 이름"
        />
        <div className="mx-2 h-5 w-px bg-neutral-200" />
        {TEMPLATES.map((t) => (
          <button key={t.id} className="btn" title={t.description} onClick={() => startFrom(projectFromTemplate(t))}>
            {t.name}
          </button>
        ))}
        <button className="btn" onClick={() => fileRef.current?.click()}>
          평면도 이미지 올리기
        </button>
        <button className="btn" onClick={() => startFrom(emptyProject())}>
          빈 도면
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && onImage(e.target.files[0])} />
        <div className="ml-auto flex items-center gap-2">
          <button className="btn" onClick={undo} disabled={!hist.past.length} title="Ctrl+Z">
            ↶
          </button>
          <button className="btn" onClick={redo} disabled={!hist.future.length} title="Ctrl+Shift+Z">
            ↷
          </button>
          <button
            className="btn"
            onClick={() =>
              downloadBlob(new Blob([JSON.stringify(project)], { type: "application/json" }), `project_${stamp()}.json`)
            }
          >
            저장
          </button>
          <button className="btn" onClick={() => jsonRef.current?.click()}>
            불러오기
          </button>
          <input ref={jsonRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && onLoadJson(e.target.files[0])} />
          <button
            className="btn"
            onClick={() => {
              if (view === "plan") setView("split");
              setDraftOpen(true);
            }}
            disabled={!project.rooms.length}
          >
            AI 초안
          </button>
          <button className="btn-primary" onClick={doExport} disabled={exporting || !project.rooms.length}>
            {exporting ? "만드는 중…" : "스케치업으로 내보내기"}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 사이드 패널 */}
        <aside className="w-72 shrink-0 space-y-5 overflow-y-auto border-r border-neutral-200 p-3 text-sm">
          {project.image && (
            <section className="space-y-2 rounded-lg bg-emerald-50 p-2">
              <h3 className="panel-title">평면도 자동 인식</h3>
              <button className="btn-primary w-full !py-2" onClick={traceAll} disabled={detecting}>
                {detecting ? "인식 중…" : "벽 그대로 3D로 만들기"}
              </button>
              <button className="btn w-full" onClick={detectAll} disabled={detecting}>
                방 단위로 인식 (직각 도면용)
              </button>
              <button className={tool === "pick" ? "btn-primary w-full" : "btn w-full"} onClick={() => setTool("pick")} disabled={detecting}>
                방 클릭 인식 (한 칸씩)
              </button>
              <label className="block text-xs text-neutral-600">
                문틈 막기 {gapStrength.toFixed(1)} — 방이 합쳐지면 올리고, 작은 방이 사라지면 내리세요
                <input className="w-full" type="range" min={0.4} max={2} step={0.1} value={gapStrength} onChange={(e) => setGapStrength(Number(e.target.value))} />
              </label>
              {detectMsg && <p className="text-xs text-emerald-900">{detectMsg}</p>}
              {project.traced && (
                <div className="space-y-1.5 border-t border-emerald-200 pt-2">
                  <MaterialPicker label="벽 마감" category="wall" value={project.traced.wallMat} onPick={(id) => updateTraced({ wallMat: id })} />
                  <button className="btn w-full text-red-600" onClick={() => update({ ...project, traced: null })}>
                    딴 벽 지우기
                  </button>
                </div>
              )}
            </section>
          )}
          <section className="space-y-2">
            <h3 className="panel-title">주방 · 욕실 설비</h3>
            <div className="grid grid-cols-2 gap-1.5">
              {Object.values(ITEM_SPECS).map((s) => (
                <button
                  key={s.type}
                  className={tool === "item" && placeType === s.type ? "btn-primary text-xs" : "btn text-xs"}
                  onClick={() => {
                    setPlaceType(s.type);
                    setTool("item");
                  }}
                >
                  {s.label.split(" ")[0]}
                </button>
              ))}
            </div>
            <button
              className="btn w-full"
              onClick={() => {
                const items = autoFixtures(project);
                if (items.length === (project.items ?? []).length) {
                  window.alert("용도가 '주방' 또는 '욕실'인 방이 없거나 이미 설비가 있습니다. 방을 선택해 용도를 바꿔주세요.");
                  return;
                }
                update({ ...project, items });
              }}
            >
              주방·욕실 기본 설비 자동 배치
            </button>
          </section>

          <section className="space-y-2">
            <h3 className="panel-title">문 · 창호</h3>
            <ColorRow label="문틀·샷시 색" value={fitColors.frame} onPick={(c) => setFitColors((f) => ({ ...f, frame: c }))} />
            <ColorRow label="문짝 색" value={fitColors.leaf} onPick={(c) => setFitColors((f) => ({ ...f, leaf: c }))} />
            <div className="grid grid-cols-2 gap-1.5">
              <button className="btn text-xs" onClick={() => fitAll("door")}>
                모든 문 자리에 문 달기
              </button>
              <button className="btn text-xs" onClick={() => fitAll("sash")}>
                모든 창 자리에 샷시
              </button>
            </div>
            <p className="text-xs text-neutral-500">현관문은 문 자리를 클릭해서 ‘현관문’으로 바꿔주세요.</p>
          </section>

          <section>
            <h3 className="panel-title">컬러 조합</h3>
            <div className="grid grid-cols-1 gap-1.5">
              {PRESETS.map((p) => (
                <button key={p.id} className="flex items-center gap-2 rounded border border-neutral-200 p-1.5 text-left hover:border-neutral-400" onClick={() => applyPreset(p.id)}>
                  <span className="flex shrink-0 overflow-hidden rounded">
                    <Swatch m={getMaterial(p.byType.living.floor)} size={22} />
                    <Swatch m={getMaterial(p.byType.living.wall)} size={22} />
                    <Swatch m={getMaterial(p.byType.bath.wall)} size={22} />
                  </span>
                  <span>
                    <span className="block font-medium">{p.name}</span>
                    <span className="block text-xs text-neutral-500">{p.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          {selectedRoom && (
            <section className="space-y-2 rounded-lg bg-blue-50 p-2">
              <h3 className="panel-title">선택한 방</h3>
              <div className="flex gap-1.5">
                <input className="input min-w-0 flex-1" value={selectedRoom.name} onChange={(e) => updateRoom(selectedRoom.id, { name: e.target.value })} />
                <select className="input" value={selectedRoom.type} onChange={(e) => updateRoom(selectedRoom.id, { type: e.target.value as RoomType })}>
                  {Object.entries(ROOM_TYPE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-neutral-600">안목 면적 약 {roomAreaM2(selectedRoom, project).toFixed(2)}㎡</p>
              <MaterialPicker label="바닥" category="floor" value={selectedRoom.floorMat} onPick={(id) => updateRoom(selectedRoom.id, { floorMat: id })} />
              <MaterialPicker label="벽" category="wall" value={selectedRoom.wallMat} onPick={(id) => updateRoom(selectedRoom.id, { wallMat: id })} />
              <div className="flex gap-1.5">
                <button className="btn flex-1" onClick={() => { setView((v) => (v === "plan" ? "split" : v)); setCamera((c) => ({ mode: "room", roomId: selectedRoom.id, nonce: c.nonce + 1 })); }}>
                  방 안에서 보기
                </button>
                <button className="btn text-red-600" onClick={deleteSelection}>
                  삭제
                </button>
              </div>
            </section>
          )}

          {selectedInfill && (
            <section className="space-y-2 rounded-lg bg-fuchsia-50 p-2">
              <h3 className="panel-title">선택한 문·창 자리</h3>
              <select
                className="input w-full"
                value={selectedInfill.kind}
                onChange={(e) =>
                  updateTraced({ infills: project.traced!.infills.map((f) => (f.id === selectedInfill.id ? { ...f, kind: e.target.value as InfillKind } : f)) })
                }
              >
                {Object.entries(INFILL_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <p className="text-xs text-neutral-600">문 위·창 아래위만 벽으로 채웁니다. 잘못 잡힌 자리면 지우세요 (그 자리는 천장까지 뚫립니다).</p>
              <FitEditor isWindow={selectedInfill.kind !== "door"} fit={selectedInfill.fit} defaults={fitColors} onChange={(fit) => setInfillFit(selectedInfill.id, fit)} />
              <button className="btn w-full text-red-600" onClick={deleteSelection}>
                삭제
              </button>
            </section>
          )}

          {selectedOpening && (
            <OpeningPanel opening={selectedOpening} project={project} onChange={(p) => updateOpening(selectedOpening.id, p)} onDelete={deleteSelection}>
              {selectedOpening.kind !== "open" && (
                <FitEditor isWindow={selectedOpening.kind === "window"} fit={selectedOpening.fit} defaults={fitColors} onChange={(fit) => updateOpening(selectedOpening.id, { fit })} />
              )}
            </OpeningPanel>
          )}

          {selectedItem && (
            <section className="space-y-2 rounded-lg bg-sky-50 p-2">
              <h3 className="panel-title">선택한 설비 · {ITEM_SPECS[selectedItem.type].label}</h3>
              <div className="grid grid-cols-2 gap-1.5">
                <label className="text-xs text-neutral-600">
                  폭(mm)
                  <input className="input w-full" type="number" value={selectedItem.w} onChange={(e) => updateItem(selectedItem.id, { w: Math.max(200, Number(e.target.value) || 0) })} />
                </label>
                <label className="text-xs text-neutral-600">
                  깊이(mm)
                  <input className="input w-full" type="number" value={selectedItem.d} onChange={(e) => updateItem(selectedItem.id, { d: Math.max(200, Number(e.target.value) || 0) })} />
                </label>
              </div>
              <div className="flex gap-1.5">
                <button className="btn flex-1" onClick={() => updateItem(selectedItem.id, { rot: (selectedItem.rot + 270) % 360 })}>
                  ↺ 90°
                </button>
                <button className="btn flex-1" onClick={() => updateItem(selectedItem.id, { rot: (selectedItem.rot + 90) % 360 })}>
                  ↻ 90°
                </button>
              </div>
              {ITEM_SPECS[selectedItem.type].colorable && (
                <ColorRow label="문짝·몸통 색" value={selectedItem.color} onPick={(c) => updateItem(selectedItem.id, { color: c })} />
              )}
              <button className="btn w-full text-red-600" onClick={deleteSelection}>
                삭제
              </button>
            </section>
          )}

          <section className="space-y-2">
            <h3 className="panel-title">축척 · 골조</h3>
            <p className="text-xs text-neutral-600">
              현재 전용면적(발코니 제외, 안목) 약 <b>{totalAreaM2(project).toFixed(1)}㎡</b> (전용 {(totalAreaM2(project) / 3.3058).toFixed(1)}평)
            </p>
            <div className="flex gap-1.5">
              <input className="input w-full" placeholder="전용면적 ㎡ (예: 84.97)" value={areaInput} onChange={(e) => setAreaInput(e.target.value)} />
              <button
                className="btn shrink-0"
                onClick={() => {
                  const v = Number(areaInput);
                  if (v > 0) patch({ mmPerPx: fitScaleToArea(project, v) });
                }}
              >
                면적에 맞춤
              </button>
            </div>
            <button className="btn w-full" onClick={() => setTool("scale")}>
              두 점 길이로 축척 맞추기
            </button>
            <div className="grid grid-cols-2 gap-1.5">
              <label className="text-xs text-neutral-600">
                천장고(mm)
                <input className="input w-full" type="number" value={project.wallHeight} onChange={(e) => patch({ wallHeight: Math.max(1500, Number(e.target.value) || 2300) })} />
              </label>
              <label className="text-xs text-neutral-600">
                벽 두께(mm)
                <input className="input w-full" type="number" value={project.wallThickness} onChange={(e) => patch({ wallThickness: Math.max(50, Number(e.target.value) || 150) })} />
              </label>
            </div>
          </section>

          <section>
            <h3 className="panel-title">방 목록</h3>
            <ul className="space-y-0.5">
              {project.rooms.map((r) => (
                <li key={r.id}>
                  <button
                    className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-neutral-100 ${r.id === selectedRoom?.id ? "bg-neutral-100 font-medium" : ""}`}
                    onClick={() => setSelection({ kind: "room", id: r.id })}
                  >
                    <Swatch m={getMaterial(r.floorMat)} size={14} />
                    <span className="flex-1">{r.name}</span>
                    <span className="text-xs text-neutral-500">{roomAreaM2(r, project).toFixed(1)}㎡</span>
                  </button>
                </li>
              ))}
              {!project.rooms.length && <li className="text-xs text-neutral-500">‘방 그리기’로 방을 추가하세요.</li>}
            </ul>
          </section>
        </aside>

        {/* 작업 영역 */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-neutral-200 px-3 py-1.5">
            {TOOLS.map((t) => (
              <button key={t.id} className={tool === t.id ? "btn-primary" : "btn"} onClick={() => setTool(t.id)} title={`단축키 ${t.key}`}>
                {t.label}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-1.5">
              <label className="mr-2 flex items-center gap-1 text-xs">
                <input type="checkbox" checked={cutaway} onChange={(e) => setCutaway(e.target.checked)} /> 벽 낮춰 보기
              </label>
              <button className="btn" onClick={() => setCamera((c) => ({ mode: "overview", nonce: c.nonce + 1 }))}>
                전체 보기
              </button>
              {(["plan", "split", "3d"] as const).map((v) => (
                <button key={v} className={view === v ? "btn-primary" : "btn"} onClick={() => setView(v)}>
                  {v === "plan" ? "2D" : v === "split" ? "분할" : "3D"}
                </button>
              ))}
            </div>
          </div>
          <p className="border-b border-neutral-100 bg-neutral-50 px-3 py-1 text-xs text-neutral-600">{hint}</p>
          <div className="flex min-h-0 flex-1">
            {view !== "3d" && (
              <div className={`min-w-0 ${view === "split" ? "w-1/2 border-r border-neutral-200" : "flex-1"}`}>
                <PlanEditor
                  project={project}
                  tool={tool}
                  selection={selection}
                  onSelect={setSelection}
                  onChange={update}
                  onToolDone={() => setTool("select")}
                  onScaleMeasured={onScaleMeasured}
                  onPick={onPick}
                  onPlace={onPlace}
                />
              </div>
            )}
            {view !== "plan" && (
              <div className="min-w-0 flex-1">
                <Viewer3D project={project} cutaway={cutaway} camera={camera} onSelectRoom={(id) => setSelection(id.startsWith("item-") ? { kind: "item", id: id.slice(5) } : { kind: "room", id })} captureRef={captureRef} />
              </div>
            )}
          </div>
        </main>
      </div>
      {draftOpen && <DraftPanel capture={() => captureRef.current?.() ?? null} onClose={() => setDraftOpen(false)} />}
    </div>
  );
}

function Swatch({ m, size }: { m: Material; size: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={textureDataUrl(m)} alt="" width={size} height={size} className="block" style={{ width: size, height: size }} />
  );
}

function MaterialPicker({ label, category, value, onPick }: { label: string; category: "floor" | "wall"; value: string; onPick: (id: string) => void }) {
  const list = MATERIALS.filter((m) => m.category === category);
  return (
    <div>
      <p className="mb-1 text-xs text-neutral-600">
        {label}: <b className="text-neutral-900">{getMaterial(value).name}</b>
      </p>
      <div className="grid grid-cols-8 gap-1">
        {list.map((m) => (
          <button key={m.id} title={m.name} onClick={() => onPick(m.id)} className={`overflow-hidden rounded ring-offset-1 ${m.id === value ? "ring-2 ring-blue-600" : "ring-1 ring-neutral-300"}`}>
            <Swatch m={m} size={26} />
          </button>
        ))}
      </div>
    </div>
  );
}

function OpeningPanel({
  opening,
  project,
  onChange,
  onDelete,
  children,
}: {
  opening: Opening;
  project: Project;
  onChange: (p: Partial<Opening>) => void;
  onDelete: () => void;
  children?: React.ReactNode;
}) {
  const width = Math.round(Math.hypot(opening.b.x - opening.a.x, opening.b.y - opening.a.y) * project.mmPerPx);
  return (
    <section className="space-y-2 rounded-lg bg-amber-50 p-2">
      <h3 className="panel-title">선택한 개구부</h3>
      <select className="input w-full" value={opening.kind} onChange={(e) => {
        const kind = e.target.value as OpeningKind;
        onChange({ kind, ...OPENING_DEFAULTS[kind] });
      }}>
        {Object.entries(OPENING_LABEL).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
      <p className="text-xs text-neutral-600">폭 약 {width}mm (끝점을 드래그해서 조절)</p>
      {opening.kind !== "open" && (
        <div className="grid grid-cols-2 gap-1.5">
          <label className="text-xs text-neutral-600">
            하단 높이(mm)
            <input className="input w-full" type="number" value={opening.sill} onChange={(e) => onChange({ sill: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
          <label className="text-xs text-neutral-600">
            상단 높이(mm)
            <input className="input w-full" type="number" value={opening.head} onChange={(e) => onChange({ head: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
        </div>
      )}
      {children}
      <button className="btn w-full text-red-600" onClick={onDelete}>
        삭제
      </button>
    </section>
  );
}

function ColorRow({ label, value, onPick }: { label: string; value: string; onPick: (hex: string) => void }) {
  return (
    <div>
      <p className="mb-1 text-xs text-neutral-600">
        {label}: <b className="text-neutral-900">{PAINT_COLORS.find((c) => c.hex === value)?.name ?? value}</b>
      </p>
      <div className="flex flex-wrap gap-1">
        {PAINT_COLORS.map((c) => (
          <button
            key={c.hex}
            title={c.name}
            aria-label={c.name}
            onClick={() => onPick(c.hex)}
            className={`h-6 w-6 rounded ring-offset-1 ${c.hex === value ? "ring-2 ring-blue-600" : "ring-1 ring-neutral-300"}`}
            style={{ background: c.hex }}
          />
        ))}
      </div>
    </div>
  );
}

/** 문·창 자리에 무엇을 달지 + 색 */
function FitEditor({
  isWindow,
  fit,
  defaults,
  onChange,
}: {
  isWindow: boolean;
  fit: Fit | undefined;
  defaults: { frame: string; leaf: string };
  onChange: (fit: Fit | undefined) => void;
}) {
  const types: FitType[] = isWindow ? ["sash"] : ["door", "entry"];
  return (
    <div className="space-y-1.5 border-t border-black/10 pt-2">
      <div className="flex flex-wrap gap-1">
        <button className={!fit ? "btn-primary text-xs" : "btn text-xs"} onClick={() => onChange(undefined)}>
          비워두기
        </button>
        {types.map((t) => (
          <button
            key={t}
            className={fit?.type === t ? "btn-primary text-xs" : "btn text-xs"}
            onClick={() => onChange(t === "entry" ? { ...FIT_DEFAULTS.entry } : { ...FIT_DEFAULTS[t], ...defaults, type: t })}
          >
            {FIT_LABEL[t]}
          </button>
        ))}
      </div>
      {fit && (
        <>
          <ColorRow label={fit.type === "sash" ? "샷시 색" : "문틀 색"} value={fit.frame} onPick={(c) => onChange({ ...fit, frame: c })} />
          {fit.type !== "sash" && <ColorRow label="문짝 색" value={fit.leaf} onPick={(c) => onChange({ ...fit, leaf: c })} />}
        </>
      )}
    </div>
  );
}
