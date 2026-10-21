"use client";

import dynamic from "next/dynamic";

// 캔버스/로컬저장소를 쓰는 편집기라 서버 렌더링 없이 브라우저에서만 띄운다
const Studio = dynamic(() => import("@/components/Studio"), {
  ssr: false,
  loading: () => <div className="grid h-dvh place-items-center text-sm text-neutral-500">불러오는 중…</div>,
});

export default function StudioLoader() {
  return <Studio />;
}
