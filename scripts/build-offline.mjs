// 인터넷·설치 없이 더블클릭으로 여는 단일 HTML 파일 만들기
//   npm run build:offline  →  dist/easyinterior.html
// AI 초안(서버 필요)을 뺀 모든 기능이 브라우저 안에서 동작한다.
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "dist");
mkdirSync(out, { recursive: true });

const tailwind = path.join(root, "node_modules/.bin/tailwindcss");
const css = path.join(out, "styles.css");
execSync(`"${tailwind}" -i src/app/globals.css -o "${css}" --minify`, { cwd: root, stdio: "inherit" });

const result = await build({
  entryPoints: [path.join(root, "src/offline/main.tsx")],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  write: false,
  jsx: "automatic",
  alias: { "next/dynamic": path.join(root, "src/offline/next-dynamic.tsx"), "@": path.join(root, "src") },
  loader: { ".css": "empty" },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});

// 스크립트 안의 </script 가 HTML을 끊지 않도록
const js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>실측없이 (내 컴퓨터용)</title>
<style>${readFileSync(css, "utf8")}</style>
</head>
<body class="h-full">
<div id="root"></div>
<script>${js}</script>
</body>
</html>
`;
const file = path.join(out, "easyinterior.html");
writeFileSync(file, html);
console.log(`${path.relative(root, file)} (${(html.length / 1024 / 1024).toFixed(1)} MB)`);
