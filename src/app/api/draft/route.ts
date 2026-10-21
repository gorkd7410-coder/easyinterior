// 레퍼런스 사진 → 초안 이미지.
// 3D 골조 화면(구조) + 고객 레퍼런스 사진(스타일)을 Gemini 이미지 모델에 함께 보내
// "구조는 그대로, 마감·색감·가구 분위기만 레퍼런스처럼" 바꾼 사진풍 이미지를 받는다.
// API 키는 서버 환경변수에만 두고 브라우저로는 내보내지 않는다.

export const maxDuration = 60;

const MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
const API_BASE = process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com";
const MAX_IMAGE_CHARS = 2_500_000; // base64 기준 약 1.8MB
const MAX_REFS = 3;

const ASPECTS: [string, number][] = [
  ["1:1", 1], ["4:3", 4 / 3], ["3:4", 3 / 4], ["3:2", 3 / 2], ["2:3", 2 / 3], ["16:9", 16 / 9], ["9:16", 9 / 16],
];

type Body = { view?: string; refs?: string[]; note?: string; aspect?: number };

function parseDataUrl(s: unknown): { mimeType: string; data: string } | null {
  if (typeof s !== "string" || s.length > MAX_IMAGE_CHARS) return null;
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(s);
  return m ? { mimeType: m[1], data: m[2] } : null;
}

function prompt(refCount: number, note: string) {
  const refs = refCount === 1 ? "Image 2 is a reference photo" : `Images 2-${refCount + 1} are reference photos`;
  return [
    "You are an interior designer creating a first-draft visualization for a client consultation.",
    "Image 1 is a plain 3D render of the client's actual apartment room: it defines the room structure.",
    `${refs} of interiors the client likes: they define the style.`,
    "Create one photorealistic interior photograph of the room in Image 1.",
    "Keep exactly the same camera viewpoint, room shape, proportions, wall positions, ceiling height, and the positions and sizes of all windows and doors from Image 1. Do not add, remove or move walls, windows or doors.",
    "Apply the style of the reference photos: flooring material and color, wall finishes, color palette, lighting mood, and furniture and decor style. Furnish the room naturally for its apparent use.",
    "Output a realistic photo, not a 3D render, with no text or watermarks.",
    note ? `Client requests (Korean may be used): ${note}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function GET() {
  return Response.json({
    enabled: !!process.env.GEMINI_API_KEY,
    needCode: !!process.env.DRAFT_ACCESS_CODE,
  });
}

export async function POST(req: Request) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return Response.json({ error: "서버에 GEMINI_API_KEY가 설정되지 않았습니다." }, { status: 501 });
  }
  // 링크만 알면 누구나 유료 API를 쓰지 않도록 간단한 접근 코드
  const code = process.env.DRAFT_ACCESS_CODE;
  if (code && req.headers.get("x-access-code") !== code) {
    return Response.json({ error: "접근 코드가 맞지 않습니다.", needCode: true }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "요청 형식이 잘못되었습니다." }, { status: 400 });
  }
  const view = parseDataUrl(body.view);
  const refs = Array.isArray(body.refs) ? body.refs.slice(0, MAX_REFS).map(parseDataUrl) : [];
  if (!view) return Response.json({ error: "3D 화면 이미지가 없거나 너무 큽니다." }, { status: 400 });
  if (!refs.length || refs.some((r) => !r)) {
    return Response.json({ error: "레퍼런스 사진이 없거나 지원하지 않는 형식/크기입니다." }, { status: 400 });
  }
  const note = typeof body.note === "string" ? body.note.slice(0, 500) : "";
  const aspect = typeof body.aspect === "number" && body.aspect > 0 ? body.aspect : 4 / 3;
  const aspectRatio = ASPECTS.reduce((best, a) => (Math.abs(Math.log(a[1] / aspect)) < Math.abs(Math.log(best[1] / aspect)) ? a : best))[0];

  const parts = [
    { text: prompt(refs.length, note) },
    { inlineData: view },
    ...refs.map((r) => ({ inlineData: r! })),
  ];

  let upstream: Response;
  try {
    upstream = await fetch(`${API_BASE}/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio } },
      }),
    });
  } catch {
    return Response.json({ error: "AI 서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요." }, { status: 502 });
  }

  type Part = { text?: string; inlineData?: { mimeType?: string; data?: string } };
  type GeminiResponse = {
    candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
    error?: { message?: string };
  };
  const json = (await upstream.json().catch(() => ({}))) as GeminiResponse;
  if (!upstream.ok) {
    const msg = upstream.status === 429 ? "AI 사용량 한도를 넘었습니다. 잠시 후 다시 시도해주세요." : json.error?.message || `AI 오류 (${upstream.status})`;
    return Response.json({ error: msg }, { status: 502 });
  }
  if (json.promptFeedback?.blockReason) {
    return Response.json({ error: `AI가 요청을 거절했습니다 (${json.promptFeedback.blockReason}). 사진을 바꿔보세요.` }, { status: 422 });
  }
  const out = json.candidates?.[0]?.content?.parts ?? [];
  const img = out.find((p) => p.inlineData?.data);
  if (!img?.inlineData?.data) {
    const text = out.map((p) => p.text).filter(Boolean).join(" ");
    return Response.json({ error: `이미지가 만들어지지 않았습니다. ${text}`.trim() }, { status: 502 });
  }
  return Response.json({
    image: `data:${img.inlineData.mimeType || "image/png"};base64,${img.inlineData.data}`,
    model: MODEL,
  });
}
