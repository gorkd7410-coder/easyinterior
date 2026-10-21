// 내 컴퓨터용 단일 HTML 파일의 시작점 (scripts/build-offline.mjs 가 묶는다)
import { createRoot } from "react-dom/client";
import Studio from "@/components/Studio";
import "@/app/globals.css";

createRoot(document.getElementById("root")!).render(<Studio />);
