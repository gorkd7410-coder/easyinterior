"use client";

import { useEffect, useRef, useState } from "react";
import { downloadBlob, stamp } from "@/lib/exportSketchup";

// 레퍼런스 사진 → 초안 이미지. 3D 화면(구조) + 고객 사진(스타일)을 /api/draft 로 보낸다.

type Props = {
  capture: () => string | null;
  onClose: () => void;
};

type Status = { enabled: boolean; needCode: boolean } | null;
type Result = { image: string; at: number };

const CODE_KEY = "interior-mvp:draft-code";

/** 업로드 한도를 넘지 않게 긴 변 1024px JPEG로 줄인다 */
async function shrink(src: string, max = 1024): Promise<{ url: string; aspect: number }> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * s);
  c.height = Math.round(img.naturalHeight * s);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return { url: c.toDataURL("image/jpeg", 0.85), aspect: c.width / c.height };
}

const readFile = (f: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(new Error("파일을 읽지 못했습니다"));
    r.readAsDataURL(f);
  });

export default function DraftPanel({ capture, onClose }: Props) {
  const [status, setStatus] = useState<Status>(null);
  const [view, setView] = useState<{ url: string; aspect: number } | null>(null);
  const [refs, setRefs] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [code, setCode] = useState(() => {
    try {
      return localStorage.getItem(CODE_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const recapture = async () => {
    const shot = capture();
    if (!shot) {
      setError("3D 화면을 찾지 못했습니다. 3D 또는 분할 보기로 바꿔주세요.");
      return;
    }
    setView(await shrink(shot));
  };

  useEffect(() => {
    fetch("/api/draft")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ enabled: false, needCode: false }));
    // 3D 화면이 막 켜지는 중일 수 있어 잠깐 기다리며 몇 번 시도
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const attempt = () => {
      const shot = capture();
      if (shot) shrink(shot).then(setView);
      else if (++tries < 10) timer = setTimeout(attempt, 300);
    };
    attempt();
    return () => clearTimeout(timer);
    // 열릴 때 한 번만 찍는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addRefs = async (files: FileList) => {
    const list = await Promise.all([...files].slice(0, 3 - refs.length).map(async (f) => (await shrink(await readFile(f))).url));
    setRefs((r) => [...r, ...list].slice(0, 3));
  };

  const generate = async () => {
    if (!view || !refs.length) return;
    setBusy(true);
    setError("");
    try {
      localStorage.setItem(CODE_KEY, code);
    } catch {
      // 접근 코드 기억은 편의 기능
    }
    try {
      const res = await fetch("/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-access-code": code },
        body: JSON.stringify({ view: view.url, refs, note, aspect: view.aspect }),
      });
      const json = (await res.json().catch(() => ({}))) as { image?: string; error?: string; needCode?: boolean };
      if (json.needCode) setStatus((s) => (s ? { ...s, needCode: true } : s));
      if (!res.ok || !json.image) throw new Error(json.error || `오류 (${res.status})`);
      setResults((r) => [{ image: json.image!, at: Date.now() }, ...r]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const download = async (r: Result) => {
    const blob = await (await fetch(r.image)).blob();
    downloadBlob(blob, `draft_${stamp(new Date(r.at))}.${blob.type.includes("png") ? "png" : "jpg"}`);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-full w-full max-w-5xl overflow-y-auto rounded-xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center">
          <h2 className="text-lg font-bold">AI 초안 만들기</h2>
          <span className="ml-2 text-xs text-neutral-500">3D 골조 + 고객 레퍼런스 사진 → 분위기 초안 이미지</span>
          <button className="btn ml-auto" onClick={onClose}>
            닫기
          </button>
        </div>

        {status && !status.enabled && (
          <p className="mb-3 rounded bg-amber-50 p-2 text-sm text-amber-900">
            아직 AI 키가 설정되지 않았습니다. 배포 설정(Vercel 환경변수)에 <code>GEMINI_API_KEY</code>를 넣으면 사용할 수 있습니다.
          </p>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <section>
              <div className="mb-1 flex items-center">
                <h3 className="panel-title !mb-0">1. 구조 (지금 3D 화면)</h3>
                <button className="btn ml-auto !py-0.5 text-xs" onClick={recapture}>
                  지금 화면 다시 찍기
                </button>
              </div>
              {view ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={view.url} alt="3D 화면" className="w-full rounded border border-neutral-200" />
              ) : (
                <div className="grid h-40 place-items-center rounded border border-dashed text-xs text-neutral-500">3D 화면 없음</div>
              )}
              <p className="mt-1 text-xs text-neutral-500">
                팁: 방을 선택하고 ‘방 안에서 보기’로 원하는 각도를 잡은 뒤 다시 찍으면 결과가 가장 좋습니다.
              </p>
            </section>

            <section>
              <h3 className="panel-title">2. 레퍼런스 사진 (최대 3장)</h3>
              <div className="flex flex-wrap gap-2">
                {refs.map((r, i) => (
                  <div key={i} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r} alt={`레퍼런스 ${i + 1}`} className="h-24 w-24 rounded border object-cover" />
                    <button
                      className="absolute right-1 top-1 rounded bg-black/60 px-1 text-xs text-white"
                      onClick={() => setRefs((x) => x.filter((_, j) => j !== i))}
                      aria-label="삭제"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {refs.length < 3 && (
                  <button className="grid h-24 w-24 place-items-center rounded border border-dashed text-xs text-neutral-500 hover:bg-neutral-50" onClick={() => fileRef.current?.click()}>
                    + 사진 추가
                  </button>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files) addRefs(e.target.files);
                  e.target.value = "";
                }}
              />
            </section>

            <section>
              <h3 className="panel-title">3. 요청사항 (선택)</h3>
              <textarea
                className="input h-16 w-full"
                placeholder="예: 바닥은 밝은 오크, 소파는 베이지, 간접조명 느낌"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
              />
            </section>

            {status?.needCode && (
              <label className="block text-xs text-neutral-600">
                접근 코드
                <input className="input w-full" type="password" value={code} onChange={(e) => setCode(e.target.value)} />
              </label>
            )}

            <button className="btn-primary w-full !py-2" onClick={generate} disabled={busy || !view || !refs.length || status?.enabled === false}>
              {busy ? "만드는 중… (보통 10~30초)" : "초안 만들기"}
            </button>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>

          <div>
            <h3 className="panel-title">결과</h3>
            {!results.length && (
              <div className="grid h-60 place-items-center rounded border border-dashed text-center text-xs text-neutral-500">
                결과가 여기에 표시됩니다.
                <br />
                같은 조건으로 여러 번 만들면 매번 다른 안이 나옵니다.
              </div>
            )}
            <div className="space-y-3">
              {results.map((r) => (
                <figure key={r.at}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.image} alt="AI 초안" className="w-full rounded border border-neutral-200" />
                  <figcaption className="mt-1 flex items-center text-xs text-neutral-500">
                    분위기 참고용 초안 — 실제 치수·구조와 다를 수 있습니다
                    <button className="btn ml-auto !py-0.5 text-xs" onClick={() => download(r)}>
                      저장
                    </button>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
