// src/App.tsx
import React, { useState, useEffect, useRef, useMemo } from "react";
import { v4 as uuidv4 } from "uuid";
import type {
  ImageStep,
  GlobalRule,
  AspectRatio,
  GlobalConfig,
  ImageSize,
  SavedProject,
  RenderedAsset,
} from "./types";
import { GeminiService } from "./services/geminiService";
import type { BookInput, BookOutputs } from "./services/bookTextService";

import StepInput from "./components/StepInput";
import BookGenerator from "./components/BookGenerator";

/** Official Gemini 3 Pro Image Preview resolutions (w×h) per aspect ratio and size. */
const GEMINI_3_PRO_IMAGE_RESOLUTIONS: Record<
  AspectRatio,
  Record<ImageSize, [number, number]>
> = {
  "1:1": { "1K": [1024, 1024], "2K": [2048, 2048], "4K": [4096, 4096] },
  "3:4": { "1K": [896, 1200], "2K": [1792, 2400], "4K": [3584, 4800] },
  "4:3": { "1K": [1200, 896], "2K": [2400, 1792], "4K": [4800, 3584] },
  "9:16": { "1K": [768, 1376], "2K": [1536, 2752], "4K": [3072, 5504] },
  "16:9": { "1K": [1376, 768], "2K": [2752, 1536], "4K": [5504, 3072] },
  "21:9": { "1K": [1584, 672], "2K": [3168, 1344], "4K": [6336, 2688] },
};

type Room = "book" | "image" | "layout";

type TypographySpec = {
  side: "left" | "right" | "center";
  overlay: { type: "gradient"; strength: number }; // 0..1
  blocks: Array<
    | {
        kind: "headline";
        text: string;
        uppercase?: boolean;
        size: number; // px
        color: string; // hex
        weight: 800 | 900;
        letterSpacing: number; // px
      }
    | {
        kind: "body";
        text: string;
        size: number;
        color: string;
        weight: 500 | 600 | 700;
        lineHeight: number; // multiplier
      }
    | {
        kind: "emphasis";
        text: string;
        uppercase?: boolean;
        size: number;
        color: string;
        weight: 900;
      }
  >;
};

type SpreadComposeItem = {
  id: string;
  spreadNumber: number; // 1..N
  text: string;
  stepId?: string; // which timeline step this spread corresponds to
  imageAssetId?: string; // which asset is selected
  textSide: "left" | "right" | "center" | "none";
  textAlign?: "left" | "center" | "right";
  textScale?: number;
  typography?: TypographySpec;
  composedDataUrl?: string; // final PNG (data:)
  textOffset?: { x: number; y: number };
  /** to vary styling page-to-page */
  styleKey?: string;
};

const getApiBaseUrl = () => {
  if (import.meta.env.DEV) return "http://localhost:8888/.netlify/functions";
  return "/.netlify/functions";
};

function parseStoryLtToSpreads(
  storyLt: string
): { spreadNumber: number; text: string }[] {
  if (!storyLt?.trim()) return [];
  const chunks = storyLt
    .split(/\n(?=Spread\s+\d+\s*\(TEXT\)\s*:)/i)
    .map((s) => s.trim())
    .filter(Boolean);

  return chunks
    .map((chunk) => {
      const m = chunk.match(/Spread\s+(\d+)\s*\(TEXT\)\s*:?\s*/i);
      const spreadNumber = m ? Number(m[1]) : 0;
      const text = chunk.replace(/Spread\s+\d+\s*\(TEXT\)\s*:?\s*/i, "").trim();
      return { spreadNumber, text };
    })
    .filter(
      (x) => x.spreadNumber >= 1 && x.spreadNumber <= 60 && x.text.length > 0
    );
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = url;
  });
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function safeHexOrFallback(v: any, fallback: string) {
  if (typeof v !== "string") return fallback;
  const s = v.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) return s;
  return fallback;
}

type Palette = {
  primary: string;
  secondary: string;
  body: string;
};

function paletteForKey(styleKey: string): Palette {
  // Max 2 accent colors (primary/secondary). Body stays near-white.
  // NOTE: UI-only (we force text to white during compose).
  switch (styleKey) {
    case "sunset":
      return { primary: "#FFB020", secondary: "#FF4D6D", body: "#F4F7FF" };
    case "ocean":
      return { primary: "#2DD4FF", secondary: "#34D399", body: "#F4F7FF" };
    case "storybook":
      return { primary: "#A78BFA", secondary: "#F472B6", body: "#F4F7FF" };
    case "comic":
    default:
      return { primary: "#60A5FA", secondary: "#F59E0B", body: "#F4F7FF" };
  }
}

function styleKeyForSpread(spreadNumber: number) {
  const mod = spreadNumber % 4;
  if (mod === 1) return "comic";
  if (mod === 2) return "storybook";
  if (mod === 3) return "ocean";
  return "sunset";
}

/**
 * ✅ FIX: Prevent duplicated sentence by splitting headline/body deterministically.
 * headline = first sentence (preferred) or first ~8 words.
 * body = remainder (so the big headline line won't repeat again in body)
 */
function splitHeadlineAndBody(
  text: string
): { headline: string; subtitle: string } {
  const cleaned = (text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return { headline: "", subtitle: "" };

  const sentences = cleaned.split(/[.!?]\s+/).filter((s) => s.trim());
  const headline = sentences[0] ? sentences[0].trim() + "." : "";
  const subtitle = sentences
    .slice(1)
    .map((s) => s.trim() + ".")
    .join(" ");
  return { headline, subtitle };
}

function pickEmphasisPhrase(text: string) {
  const cleaned = (text || "")
    .replace(/\s+/g, " ")
    .replace(/[“”"]/g, "")
    .trim();
  if (!cleaned) return "";

  const words = cleaned.split(" ").filter(Boolean);
  if (words.length < 6)
    return words.slice(0, Math.min(3, words.length)).join(" ");

  const start = clamp(
    Math.floor(words.length * 0.45),
    0,
    Math.max(0, words.length - 4)
  );
  return words.slice(start, start + 3).join(" ");
}

/**
 * ✅ FIX: Scale type from HEIGHT, not min(width,height). This avoids giant text on 21:9.
 * Small boosts for tall-ish pages so it doesn't get too small.
 */
function getTypeBase(outputW: number, outputH: number) {
  const ratio = outputW / outputH;
  const ratioBoost = ratio > 1.9 ? 1.0 : ratio < 1.1 ? 1.08 : 1.04;
  return outputH * ratioBoost;
}

/**
 * ✅ FIXES:
 * - Uses outputH-based scaling (prevents huge type on 21:9)
 * - Forces text to be EXACT story text (no AI rewriting)
 * - Prevents duplicate sentence by removing headline from body
 * - ✅ FORCE ALL TEXT TO WHITE
 * - Page-to-page variation only affects styling, not the text
 */
function normalizeTypographySpec(
  incoming: TypographySpec | undefined,
  spreadNumber: number,
  outputW: number,
  outputH: number,
  forceText?: { headline: string; subtitle: string }
): TypographySpec {
  const WHITE = "#FFFFFF";
  const styleKey = styleKeyForSpread(spreadNumber);
  const pal = paletteForKey(styleKey); // UI-only (dots)

  const side =
    incoming?.side === "left" ||
    incoming?.side === "right" ||
    incoming?.side === "center"
      ? incoming.side
      : "left";

  const overlayStrength = clamp(incoming?.overlay?.strength ?? 0.72, 0.55, 0.85);

  const base = getTypeBase(outputW, outputH);

  // ✅ Slightly smaller caps vs previous to avoid "too big" look on wide pages
  const headlineMin = Math.round(base * 0.042);
  const headlineMax = Math.round(base * 0.065);
  const emphasisMin = Math.round(base * 0.032);
  const emphasisMax = Math.round(base * 0.05);
  const bodyMin = Math.round(base * 0.022);
  const bodyMax = Math.round(base * 0.035);

  const profile = spreadNumber % 3;
  const headlineUpper = profile === 2;
  const headlineLS = profile === 0 ? 1 : 0;

  let headlineText = forceText?.headline ?? "";
  let subtitleText = forceText?.subtitle ?? "";

  // If forceText is absent, do NOT invent text; just reuse what exists.
  if (!headlineText && incoming?.blocks?.length) {
    const head = incoming.blocks.find((b: any) => b?.kind === "headline") as any;
    headlineText = (head?.text ?? "").toString().trim();
  }
  if (!subtitleText && incoming?.blocks?.length) {
    const body = incoming.blocks.find((b: any) => b?.kind === "body") as any;
    subtitleText = (body?.text ?? "").toString().trim();
  }

  // Remove duplicate headline from subtitle
  if (headlineText && subtitleText) {
    const h = headlineText.replace(/\s+/g, " ").trim();
    const s = subtitleText.replace(/\s+/g, " ").trim();
    if (s.startsWith(h)) {
      subtitleText = s
        .slice(h.length)
        .trim()
        .replace(/^[,:\-\u2013\u2014]\s*/, "");
    }
  }

  const emphasisText = subtitleText;

  const headlineSize =
    profile === 0
      ? clamp(Math.round(base * 0.058), headlineMin, headlineMax)
      : profile === 1
      ? clamp(Math.round(base * 0.055), headlineMin, headlineMax)
      : clamp(Math.round(base * 0.061), headlineMin, headlineMax);

  const emphasisSize =
    profile === 0
      ? clamp(Math.round(base * 0.044), emphasisMin, emphasisMax)
      : profile === 1
      ? clamp(Math.round(base * 0.041), emphasisMin, emphasisMax)
      : clamp(Math.round(base * 0.046), emphasisMin, emphasisMax);

  const bodySize =
    profile === 0
      ? clamp(Math.round(base * 0.03), bodyMin, bodyMax)
      : profile === 1
      ? clamp(Math.round(base * 0.028), bodyMin, bodyMax)
      : clamp(Math.round(base * 0.031), bodyMin, bodyMax);

  const bodyLH = profile === 2 ? 1.28 : profile === 1 ? 1.32 : 1.34;

  const blocks: TypographySpec["blocks"] = [];

  if (headlineText) {
    blocks.push({
      kind: "headline",
      text: headlineText,
      uppercase: headlineUpper,
      size: headlineSize,
      color: safeHexOrFallback(WHITE, pal.body),
      weight: 900,
      letterSpacing: headlineLS,
    });
  }

  if (emphasisText) {
    blocks.push({
      kind: "emphasis",
      text: emphasisText,
      uppercase: profile === 0,
      size: emphasisSize,
      color: safeHexOrFallback(WHITE, pal.body),
      weight: 900,
    });
  }

  // (Optional body block kept for compatibility if you ever add it back)
  // If you want a 3rd block later, uncomment:
  // if (subtitleText) {
  //   blocks.push({
  //     kind: "body",
  //     text: subtitleText,
  //     size: bodySize,
  //     color: WHITE,
  //     weight: 600,
  //     lineHeight: bodyLH,
  //   });
  // }

  return {
    side,
    overlay: { type: "gradient", strength: overlayStrength },
    blocks,
  };
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeightPx: number,
  letterSpacingPx: number,
  align: "left" | "center" | "right"
) {
  const words = text.split(/\s+/).filter(Boolean);
  let line = "";

  const measureLine = (s: string) => {
    if (!letterSpacingPx) return ctx.measureText(s).width;
    let width = 0;
    for (let i = 0; i < s.length; i += 1) {
      const ch = s[i];
      width += ctx.measureText(ch).width;
      if (i < s.length - 1) width += letterSpacingPx;
    }
    return width;
  };

  const alignStartX = (s: string) => {
    const lineW = measureLine(s);
    const remaining = Math.max(0, maxWidth - lineW);
    if (align === "center") return x + remaining / 2;
    if (align === "right") return x + remaining;
    return x;
  };

  const drawLine = (s: string, yy: number) => {
    const startX = alignStartX(s);
    if (!letterSpacingPx) {
      ctx.fillText(s, startX, yy);
      return;
    }
    let xx = startX;
    for (const ch of s) {
      ctx.fillText(ch, xx, yy);
      xx += ctx.measureText(ch).width + letterSpacingPx;
    }
  };

  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    const width = ctx.measureText(test).width + letterSpacingPx * test.length;
    if (width > maxWidth && line) {
      drawLine(line, y);
      line = w;
      y += lineHeightPx;
    } else {
      line = test;
    }
  }

  if (line) {
    drawLine(line, y);
    y += lineHeightPx;
  }

  return y;
}

function getTextBox(
  spec: TypographySpec,
  outputW: number,
  outputH: number,
  offset?: { x: number; y: number }
) {
  const pad = Math.round(outputW * 0.05);
  const boxW =
    spec.side === "center"
      ? Math.round(outputW * 0.8)
      : Math.round(outputW * 0.5);
  let x0 =
    spec.side === "center"
      ? Math.round((outputW - boxW) / 2)
      : spec.side === "left"
      ? pad
      : outputW - pad - boxW;
  let y0 = Math.round(outputH * 0.1);

  if (offset) {
    x0 += offset.x;
    y0 += offset.y;
  }

  x0 = clamp(x0, 0, outputW - boxW);
  y0 = clamp(y0, 0, Math.round(outputH * 0.9));

  const boxH = Math.round(outputH * 0.4);
  return { x0, y0, boxW, boxH };
}

async function composeSpreadImage(
  imageUrl: string,
  spec: TypographySpec,
  outputW: number,
  outputH: number,
  offset?: { x: number; y: number },
  align: "left" | "center" | "right" = "left",
  scale: number = 1,
  lineGap: number = 1
): Promise<string> {
  const img = await loadImage(imageUrl);
  const canvas = document.createElement("canvas");
  canvas.width = outputW;
  canvas.height = outputH;

  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, outputW, outputH);
  ctx.drawImage(img, 0, 0, outputW, outputH);

  // overlay for readability
  const strength = clamp(spec.overlay?.strength ?? 0.72, 0.55, 0.85);
  const a = 0.9 * strength;

  if (spec.side !== "center") {
    const g = ctx.createLinearGradient(
      spec.side === "left" ? 0 : outputW,
      0,
      spec.side === "left" ? outputW * 0.62 : outputW * 0.38,
      0
    );
    g.addColorStop(0, `rgba(0,0,0,${a})`);
    g.addColorStop(0.55, `rgba(0,0,0,${a * 0.35})`);
    g.addColorStop(1, `rgba(0,0,0,0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, outputW, outputH);
  }

  const { x0, y0, boxW } = getTextBox(spec, outputW, outputH, offset);
  let y = y0;

  ctx.textBaseline = "top";

  // ✅ FORCE WHITE ALWAYS (even if JSON contains other colors)
  const FORCE_WHITE = "#FFFFFF";

  // ✅ Calculate uniform text size (average of all blocks)
  const uniformBaseSize = Math.round(
    spec.blocks.reduce((sum, b) => sum + b.size, 0) / Math.max(1, spec.blocks.length)
  );

  for (const block of spec.blocks) {
    // ✅ Use uniform size for all blocks instead of different sizes
    const scaledSize = Math.round(uniformBaseSize * scale);
    
    if (block.kind === "headline") {
      const t = block.uppercase ? block.text.toUpperCase() : block.text;
      ctx.font = `${block.weight} ${scaledSize}px "Plus Jakarta Sans", system-ui, -apple-system, Segoe UI`;
      ctx.fillStyle = FORCE_WHITE;

      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 2;

      // ✅ Apply lineGap multiplier to line height
      const baseLineHeight = Math.round(scaledSize * 1.08);
      const lineHeight = Math.round(baseLineHeight * lineGap);

      y = drawWrappedText(
        ctx,
        t,
        x0,
        y,
        boxW,
        lineHeight,
        block.letterSpacing ?? 0,
        align
      );
      // ✅ USE SAME GAP FOR ALL BLOCKS
      y += Math.round(outputH * 0.008 * lineGap);
      continue;
    }

    if (block.kind === "emphasis") {
      const t = block.uppercase ? block.text.toUpperCase() : block.text;
      ctx.font = `${block.weight} ${scaledSize}px "Plus Jakarta Sans", system-ui, -apple-system, Segoe UI`;
      ctx.fillStyle = FORCE_WHITE;

      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 2;

      // ✅ Apply lineGap multiplier to line height
      const baseLineHeight = Math.round(scaledSize * 1.12);
      const lineHeight = Math.round(baseLineHeight * lineGap);

      y = drawWrappedText(ctx, t, x0, y, boxW, lineHeight, 0, align);
      // ✅ USE SAME GAP FOR ALL BLOCKS
      y += Math.round(outputH * 0.008 * lineGap);
      continue;
    }

    if (block.kind === "body") {
      ctx.font = `${block.weight} ${scaledSize}px "Plus Jakarta Sans", system-ui, -apple-system, Segoe UI`;
      ctx.fillStyle = FORCE_WHITE;

      ctx.shadowColor = "rgba(0,0,0,0.28)";
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 2;

      // ✅ Apply lineGap multiplier to line height
      const baseLineHeight = Math.round(scaledSize * (block.lineHeight ?? 1.32));
      const lineHeight = Math.round(baseLineHeight * lineGap);

      y = drawWrappedText(ctx, block.text, x0, y, boxW, lineHeight, 0, align);
      // ✅ USE SAME GAP FOR ALL BLOCKS
      y += Math.round(outputH * 0.008 * lineGap);
    }
  }

  ctx.shadowColor = "rgba(0,0,0,0)";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  return canvas.toDataURL("image/png");
}

const App: React.FC = () => {
  const createInitialSteps = (): ImageStep[] => {
    const steps: ImageStep[] = [];
    steps.push({
      id: uuidv4(),
      type: "cover",
      prompt: "",
      status: "idle",
      textSide: "none",
      bookTitle: "",
      cast: "",
      showText: true,
    });
    steps.push({
      id: uuidv4(),
      type: "title",
      prompt: "",
      status: "idle",
      textSide: "none",
      bookTitle: "",
      cast: "",
    });
    steps.push({
      id: uuidv4(),
      type: "first",
      prompt: "",
      status: "idle",
      textSide: "left",
    });
    steps.push({
      id: uuidv4(),
      type: "last",
      prompt: "",
      status: "idle",
      textSide: "none",
      bookTitle: "",
      cast: "",
    });
    return steps;
  };

  const [steps, setSteps] = useState<ImageStep[]>(createInitialSteps());
  const [rules, setRules] = useState<GlobalRule[]>([]);
  const [characterRef, setCharacterRef] = useState<string | null>(null);

  const [config, setConfig] = useState<GlobalConfig>({
    aspectRatio: "21:9",
    imageSize: "4K",
    bleedPercent: 15,
    demographicExclusion: true,
  });

  const getOutputDimensions = (): { width: number; height: number } => {
    const [width, height] =
      GEMINI_3_PRO_IMAGE_RESOLUTIONS[config.aspectRatio][config.imageSize];
    return { width, height };
  };

  const [isProcessActive, setIsProcessActive] = useState(false);
  const isProcessActiveRef = useRef(false);
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  const [currentQueueIndex, setCurrentQueueIndex] = useState(-1);
  const [awaitingApproval, setAwaitingApproval] = useState(false);
  const [isSuggestingTitle, setIsSuggestingTitle] = useState(false);

  const [quickPasteText, setQuickPasteText] = useState("");
  const [showQuickPaste, setShowQuickPaste] = useState(false);

  const [generationPhase, setGenerationPhase] = useState<
    "idle" | "background" | "title" | "cast" | "scene"
  >("idle");

  const [assets, setAssets] = useState<RenderedAsset[]>([]);
  const [activeRoom, setActiveRoom] = useState<Room>("book");

  // Layout Room state
  const [layoutSpreads, setLayoutSpreads] = useState<SpreadComposeItem[]>([]);
  const [layoutBusyId, setLayoutBusyId] = useState<string | null>(null);

  const [showSavedProjects, setShowSavedProjects] = useState(false);
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>([]);
  const [bookGeneratorKey, setBookGeneratorKey] = useState(0);

  // keeping (even if you use them elsewhere)
  const [showAssetGallery, setShowAssetGallery] = useState(false);
  const [isGalleryMinimized, setIsGalleryMinimized] = useState(false);
  const [regeneratingAssetId, setRegeneratingAssetId] = useState<string | null>(
    null
  );
  const [regenerateEditPrompt, setRegenerateEditPrompt] = useState("");
  const [selectedAssetForPreview, setSelectedAssetForPreview] = useState<
    string | null
  >(null);

  const getGemini = () => new GeminiService();

  const handleCharacterUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setCharacterRef(reader.result as string);
    reader.readAsDataURL(file);
  };

  const updateStep = (id: string, updates: Partial<ImageStep>) =>
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...updates } : s)));

  const deleteStep = (id: string) =>
    setSteps((prev) => prev.filter((s) => s.id !== id));

  const addPendingAsset = (
    label: string,
    stepId?: string,
    stepType?: string,
    coverPart?: "background" | "title" | "cast"
  ) => {
    const pendingId = uuidv4();
    setAssets((prev) => [
      {
        id: pendingId,
        url: "",
        label,
        timestamp: Date.now(),
        stepId,
        stepType,
        coverPart,
        isPending: true,
      },
      ...prev,
    ]);
    return pendingId;
  };

  const replacePendingAsset = (
    pendingId: string,
    url: string,
    originalPrompt?: string
  ) => {
    setAssets((prev) =>
      prev.map((a) =>
        a.id === pendingId
          ? { ...a, url, isPending: false, originalPrompt, timestamp: Date.now() }
          : a
      )
    );
  };

  const removePendingAsset = (pendingId: string) => {
    setAssets((prev) => prev.filter((a) => a.id !== pendingId));
  };

  const handleRetryStuckAsset = (asset: RenderedAsset) => {
    if (!asset.isPending) return;
    removePendingAsset(asset.id);
  };

  /** Spread number 1..N for first/middle/last steps; null for cover/title */
  const getSpreadNumber = (step: ImageStep, stepList: ImageStep[]): number | null => {
    if (step.type !== "first" && step.type !== "middle" && step.type !== "last")
      return null;
    const spreadSteps = stepList.filter(
      (s) => s.type === "first" || s.type === "middle" || s.type === "last"
    );
    const idx = spreadSteps.findIndex((s) => s.id === step.id);
    return idx >= 0 ? idx + 1 : null;
  };

  const addSpread = () => {
    setSteps((prev) => {
      const newSteps = [...prev];
      const lastIdx = newSteps.findIndex((s) => s.type === "last");
      newSteps.splice(lastIdx, 0, {
        id: uuidv4(),
        type: "middle",
        prompt: "",
        status: "idle",
        textSide: "none",
      });
      return newSteps;
    });
  };

  // Quick paste (legacy)
  const handleQuickPaste = () => {
    if (!quickPasteText.trim()) return;

    const spreadBlocks = quickPasteText
      .split(/(?=Spread \d+)|(?=COVER\b)/i)
      .filter((b) => b.trim());

    const middlePrompts: string[] = [];
    let coverPrompt = "";

    spreadBlocks.forEach((block) => {
      const trimmed = block.trim();
      const lower = trimmed.toLowerCase();

      if (lower.startsWith("spread")) {
        const clean = trimmed
          .replace(/Spread \d+\s*\((SCENE|PROMPT)\)\s*:/gi, "")
          .trim();
        if (clean) middlePrompts.push(clean);
      } else if (lower.startsWith("cover")) {
        const clean = trimmed.replace(/COVER\s*:?/gi, "").trim();
        if (clean) coverPrompt = clean;
      }
    });

    setSteps((prev) => {
      const cover = prev.find((s) => s.type === "cover")!;
      const first = prev.find((s) => s.type === "first")!;
      const last = prev.find((s) => s.type === "last")!;
      const title = prev.find((s) => s.type === "title");

      const middleSteps: ImageStep[] = middlePrompts.map((prompt) => ({
        id: uuidv4(),
        type: "middle",
        prompt,
        status: "idle",
        textSide: "none",
      }));

      const base = [
        { ...cover, prompt: coverPrompt || cover.prompt },
        ...(title ? [title] : []),
        { ...first, prompt: "Cinematic Logo" },
        ...middleSteps,
        { ...last, prompt: "Closing Card" },
      ];

      return base;
    });

    setQuickPasteText("");
    setShowQuickPaste(false);
  };

  // Load saved projects from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("savedProjects");
      if (saved) setSavedProjects(JSON.parse(saved));
    } catch (e) {
      console.error("Error loading saved projects:", e);
    }
  }, []);

  // Save projects to localStorage whenever savedProjects changes
  useEffect(() => {
    try {
      localStorage.setItem("savedProjects", JSON.stringify(savedProjects));
    } catch (e) {
      console.error("Error saving projects:", e);
    }
  }, [savedProjects]);

  const saveCurrentProject = () => {
    const projectName = prompt("Enter a name for this project:");
    if (!projectName || !projectName.trim()) return;

    const bookInput = localStorage.getItem("bookGenerator_input");
    const bookOutputs = localStorage.getItem("bookGenerator_outputs");
    const selectedTitle = localStorage.getItem("bookGenerator_selectedTitle");

    const project: SavedProject = {
      id: uuidv4(),
      name: projectName.trim(),
      savedAt: Date.now(),
      bookInput: bookInput ? JSON.parse(bookInput) : undefined,
      bookOutputs: bookOutputs ? JSON.parse(bookOutputs) : undefined,
      selectedTitle: selectedTitle || undefined,
      steps: [...steps],
      assets: [...assets],
      config: { ...config },
      characterRef,
      rules: [...rules],
      quickPasteText,
      // @ts-ignore (backwards compatible)
      layoutSpreads: layoutSpreads,
    };

    setSavedProjects((prev) => [project, ...prev]);
    setShowSavedProjects(false);
  };

  const loadProject = (project: SavedProject) => {
    if (!confirm(`Load "${project.name}"? This will replace your current work.`)) return;

    if (project.bookInput)
      localStorage.setItem("bookGenerator_input", JSON.stringify(project.bookInput));
    if (project.bookOutputs)
      localStorage.setItem("bookGenerator_outputs", JSON.stringify(project.bookOutputs));
    if (project.selectedTitle)
      localStorage.setItem("bookGenerator_selectedTitle", project.selectedTitle);

    setSteps(project.steps.map((s: ImageStep) => ({ ...s })));
    setAssets(project.assets.map((a: RenderedAsset) => ({ ...a })));
    setConfig({ ...project.config });
    setCharacterRef(project.characterRef);
    setRules(project.rules.map((r: GlobalRule) => ({ ...r })));
    setQuickPasteText(project.quickPasteText);

    // @ts-ignore
    if ((project as any).layoutSpreads) setLayoutSpreads((project as any).layoutSpreads);

    setShowSavedProjects(false);
    setBookGeneratorKey((prev) => prev + 1);
  };

  const deleteProject = (projectId: string) => {
    if (!confirm("Delete this saved project?")) return;
    setSavedProjects((prev) => prev.filter((p) => p.id !== projectId));
  };

  // Enhanced transfer from BookGenerator
  const transferAllTextToImageRoom = (
    outputs: BookOutputs,
    input: BookInput,
    selectedTitle: string
  ) => {
    const coverStep = steps.find((s) => s.type === "cover");
    const titleStep = steps.find((s) => s.type === "title");

    if (coverStep) {
      updateStep(coverStep.id, {
        prompt: outputs.coverPromptEn || coverStep.prompt,
        bookTitle: selectedTitle || coverStep.bookTitle,
        cast: input.name || coverStep.cast,
        showText: true,
      });
    }

    if (titleStep) {
      updateStep(titleStep.id, {
        prompt: outputs.titleLogoPromptEn || titleStep.prompt,
        bookTitle: selectedTitle || titleStep.bookTitle,
      });
    }

    if (outputs.spreadPromptsEn) {
      const spreadChunks = outputs.spreadPromptsEn
        .split(/\n(?=Spread\s+\d+\s*\((?:PROMPT|SCENE)\)\s*:?\s*)/gi)
        .map((s) => s.trim())
        .filter(Boolean);

      const cleanPrompt = (chunk: string) =>
        chunk.replace(/Spread\s+\d+\s*\((?:PROMPT|SCENE)\)\s*:?\s*/gi, "").trim();

      const N = spreadChunks.length;
      const spread1Prompt = N > 0 ? cleanPrompt(spreadChunks[0]) : "";
      const middleChunks = N > 2 ? spreadChunks.slice(1, -1) : [];
      const lastChunkPrompt = N > 1 ? cleanPrompt(spreadChunks[N - 1]) : "";

      setSteps((prevSteps) => {
        const cover = prevSteps.find((s) => s.type === "cover")!;
        const title = prevSteps.find((s) => s.type === "title");

        const firstUpdated: ImageStep = {
          id: uuidv4(),
          type: "first",
          prompt: spread1Prompt,
          status: "idle",
          textSide: "left",
        };

        const newMiddleSteps: ImageStep[] = middleChunks.map((chunk) => ({
          id: uuidv4(),
          type: "middle" as const,
          prompt: cleanPrompt(chunk) || "",
          status: "idle" as const,
          textSide: "none" as const,
        }));

        const spreadSteps: ImageStep[] =
          N >= 2
            ? [
                firstUpdated,
                ...newMiddleSteps,
                {
                  id: uuidv4(),
                  type: "last" as const,
                  prompt: lastChunkPrompt,
                  status: "idle" as const,
                  textSide: "none" as const,
                  bookTitle: "",
                  cast: "",
                },
              ]
            : [firstUpdated];

        if (!title) return [cover, ...spreadSteps];

        const titleUpdated = {
          ...title,
          prompt: outputs.titleLogoPromptEn || title.prompt,
          bookTitle: selectedTitle || title.bookTitle,
        };
        return [cover, titleUpdated, ...spreadSteps];
      });
    }

    // Backward compatibility quick-paste
    const blocks: string[] = [];
    if (outputs.coverPromptEn) blocks.push(`COVER: ${outputs.coverPromptEn}`);
    if (outputs.spreadPromptsEn) {
      const spreadChunks = outputs.spreadPromptsEn
        .split(/\n(?=Spread\s+\d+\s+\(PROMPT\)\s*:)/gi)
        .map((s) => s.trim())
        .filter(Boolean);
      spreadChunks.forEach((chunk) => blocks.push(chunk.replace(/\(PROMPT\)/gi, "(SCENE)")));
    }
    if (blocks.length > 0) setQuickPasteText(blocks.join("\n\n"));
  };

  // -------- Layout Room: build data ----------
  const openLayoutRoom = () => {
    const outputsRaw = localStorage.getItem("bookGenerator_outputs");
    const outputs: BookOutputs | null = outputsRaw ? JSON.parse(outputsRaw) : null;
    const storyLt = outputs?.storyLt || "";

    const storySpreads = parseStoryLtToSpreads(storyLt);

    const spreadSteps = steps.filter(
      (s) => s.type === "first" || s.type === "middle" || s.type === "last"
    );
    const bySpreadNumber = new Map<number, ImageStep>();
    spreadSteps.forEach((st, idx) => bySpreadNumber.set(idx + 1, st));

    const latestAssetByStepId = new Map<string, RenderedAsset>();
    for (const a of assets) {
      if (!a.stepId || a.isPending || !a.url) continue;
      const existing = latestAssetByStepId.get(a.stepId);
      if (!existing || a.timestamp > existing.timestamp) latestAssetByStepId.set(a.stepId, a);
    }

    const next: SpreadComposeItem[] = storySpreads.map((s) => {
      const st = bySpreadNumber.get(s.spreadNumber);
      const defaultAsset = st?.id ? latestAssetByStepId.get(st.id) : undefined;

      const defaultSide =
        st?.textSide === "left" ||
        st?.textSide === "right" ||
        st?.textSide === "center" ||
        st?.textSide === "none"
          ? st.textSide
          : "none";

      return {
        id: uuidv4(),
        spreadNumber: s.spreadNumber,
        text: s.text,
        stepId: st?.id,
        imageAssetId: defaultAsset?.id,
        textSide: defaultSide,
        textAlign: "left",
        textScale: 1,
        lineGap: 1,
        typography: undefined,
        composedDataUrl: undefined,
        textOffset: { x: 0, y: 0 },
        styleKey: styleKeyForSpread(s.spreadNumber),
      };
    });

    setLayoutSpreads(next);
    setActiveRoom("layout");
  };

  const updateLayoutSpread = (id: string, updates: Partial<SpreadComposeItem>) => {
    setLayoutSpreads((prev) => prev.map((s) => (s.id === id ? { ...s, ...updates } : s)));
  };

  const textDragRef = useRef<
    | null
    | {
        id: string;
        startX: number;
        startY: number;
        startOffsetX: number;
        startOffsetY: number;
        outputW: number;
        outputH: number;
        previewW: number;
        previewH: number;
      }
  >(null);

  const beginTextDrag = (
    spreadId: string,
    event: React.MouseEvent<HTMLDivElement>,
    outputW: number,
    outputH: number,
    currentOffset?: { x: number; y: number }
  ) => {
    const container = event.currentTarget.parentElement;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    textDragRef.current = {
      id: spreadId,
      startX: event.clientX,
      startY: event.clientY,
      startOffsetX: currentOffset?.x ?? 0,
      startOffsetY: currentOffset?.y ?? 0,
      outputW,
      outputH,
      previewW: rect.width,
      previewH: rect.height,
    };

    const handleMove = (e: MouseEvent) => {
      const state = textDragRef.current;
      if (!state) return;

      const dx = (e.clientX - state.startX) * (state.outputW / state.previewW);
      const dy = (e.clientY - state.startY) * (state.outputH / state.previewH);

      updateLayoutSpread(state.id, {
        textOffset: {
          x: state.startOffsetX + dx,
          y: state.startOffsetY + dy,
        },
        composedDataUrl: undefined,
      });
    };

    const handleUp = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      textDragRef.current = null;
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  };

  // -------- Image generation pipeline ----------
  const executeCurrentStep = async (index: number) => {
    const step = steps[index];
    setSteps((prev) => prev.map((s, idx) => (idx === index ? { ...s, status: "generating" } : s)));

    let pendingId: string | null = null;

    try {
      const gemini = getGemini();
      const ruleTexts = rules.map((r) => r.text).filter((t) => t.trim().length > 0);
      const previousImage = index > 0 ? steps[index - 1].generatedImageUrl : undefined;

      if (step.type === "cover") {
        setGenerationPhase("background");
        pendingId = addPendingAsset("Cover Background (Seamless)", step.id, step.type, "background");
        const bgUrl = await gemini.generateStepImage(
          { ...step, coverPart: "background" } as any,
          ruleTexts,
          config,
          previousImage,
          characterRef || undefined
        );
        updateStep(step.id, { generatedImageUrl: bgUrl });
        replacePendingAsset(pendingId, bgUrl, step.prompt);
        setSteps((prev) => prev.map((s, idx) => (idx === index ? { ...s, status: "completed" } : s)));
      } else if (step.type === "title") {
        setGenerationPhase("title");
        pendingId = addPendingAsset("Book Title Page", step.id, step.type);
        const imageUrl = await gemini.generateStepImage(
          step,
          ruleTexts,
          config,
          previousImage,
          characterRef || undefined
        );
        updateStep(step.id, { generatedImageUrl: imageUrl });
        replacePendingAsset(pendingId, imageUrl, step.bookTitle || "Book Title");
        setSteps((prev) =>
          prev.map((s, idx) => (idx === index ? { ...s, status: "completed", generatedImageUrl: imageUrl } : s))
        );
      } else {
        setGenerationPhase("scene");
        const label =
          step.type === "last"
            ? "Ending Card"
            : step.type === "first"
            ? "Spread 1 Artwork"
            : `Spread ${index - 1} Artwork`;
        pendingId = addPendingAsset(label, step.id, step.type);
        const imageUrl = await gemini.generateStepImage(
          step,
          ruleTexts,
          config,
          previousImage,
          characterRef || undefined
        );
        setSteps((prev) =>
          prev.map((s, idx) => (idx === index ? { ...s, status: "completed", generatedImageUrl: imageUrl } : s))
        );
        replacePendingAsset(pendingId, imageUrl, step.prompt);
      }

      setGenerationPhase("idle");
      setAwaitingApproval(true);
    } catch (err: any) {
      setSteps((prev) =>
        prev.map((s, idx) => (idx === index ? { ...s, status: "error", error: err.message } : s))
      );
      if (pendingId) removePendingAsset(pendingId);
      setIsProcessActive(false);
      isProcessActiveRef.current = false;
      setGenerationPhase("idle");
    }
  };

  const activeQueueSteps = steps
    .map((s, i) => (s.prompt.trim() || s.type === "cover" || s.type === "title" ? i : -1))
    .filter((i) => i !== -1);

  const currentActiveStep =
    currentQueueIndex >= 0 ? steps[activeQueueSteps[currentQueueIndex]] : null;

  const startNarrativeFlow = async () => {
    const queue = activeQueueSteps;
    if (queue.length === 0) return;

    setIsProcessActive(true);
    isProcessActiveRef.current = true;
    setIsPaused(false);
    isPausedRef.current = false;
    setCurrentQueueIndex(0);
    setAwaitingApproval(false);

    for (let i = 0; i < queue.length; i++) {
      while (isPausedRef.current && isProcessActiveRef.current)
        await new Promise((r) => setTimeout(r, 100));
      if (!isProcessActiveRef.current) break;

      setCurrentQueueIndex(i);
      await executeCurrentStep(queue[i]);

      while (isPausedRef.current && isProcessActiveRef.current)
        await new Promise((r) => setTimeout(r, 100));
      if (!isProcessActiveRef.current) break;

      if (i < queue.length - 1) {
        setCurrentQueueIndex(i + 1);
        setAwaitingApproval(false);
      }
    }

    setIsProcessActive(false);
    isProcessActiveRef.current = false;
    setIsPaused(false);
    setCurrentQueueIndex(-1);
    setAwaitingApproval(false);
    setGenerationPhase("idle");
  };

  const handlePause = () => {
    setIsPaused(true);
    isPausedRef.current = true;
  };

  const handleResume = () => {
    setIsPaused(false);
    isPausedRef.current = false;
  };

  const handleStop = () => {
    setIsProcessActive(false);
    isProcessActiveRef.current = false;
    setIsPaused(false);
    isPausedRef.current = false;
    setCurrentQueueIndex(-1);
    setAwaitingApproval(false);
    setGenerationPhase("idle");
  };

  const handleApproval = async () => {
    const queue = activeQueueSteps;
    const nextQueueIdx = currentQueueIndex + 1;
    if (nextQueueIdx < queue.length) {
      setCurrentQueueIndex(nextQueueIdx);
      setAwaitingApproval(false);
      await executeCurrentStep(queue[nextQueueIdx]);
    } else {
      setIsProcessActive(false);
      isProcessActiveRef.current = false;
      setCurrentQueueIndex(-1);
      setAwaitingApproval(false);
    }
  };

  const handleGenerateTitle = async (id: string) => {
    if (isSuggestingTitle) return;
    const step = steps.find((s) => s.id === id);
    if (!step) return;

    if (step.bookTitle && step.bookTitle.trim().length > 0) return;

    setIsSuggestingTitle(true);
    try {
      const gemini = getGemini();
      const allPrompts = steps.map((s) => s.prompt).filter((p) => p && p.trim().length > 0);
      const analysis = await gemini.analyzeStory(allPrompts);

      updateStep(id, { bookTitle: analysis.title, storyStyle: analysis.visualStyle });

      const titlePage = steps.find((s) => s.type === "title");
      if (titlePage) updateStep(titlePage.id, { bookTitle: analysis.title, storyStyle: analysis.visualStyle });

      const lastPage = steps.find((s) => s.type === "last");
      if (lastPage) updateStep(lastPage.id, { storyStyle: analysis.visualStyle });
    } finally {
      setIsSuggestingTitle(false);
    }
  };

  const handleGenerateSingleStep = async (stepId: string) => {
    const stepIndex = steps.findIndex((s) => s.id === stepId);
    if (stepIndex === -1) return;

    const step = steps[stepIndex];
    if (!step || (!step.prompt.trim() && step.type !== "title")) return;

    setSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, status: "generating" } : s)));

    try {
      const gemini = getGemini();
      const ruleTexts = rules.map((r) => r.text).filter((t) => t.trim().length > 0);
      const previousImage = stepIndex > 0 ? steps[stepIndex - 1].generatedImageUrl : undefined;

      if (step.type === "cover") {
        setGenerationPhase("background");
        const pendingId = addPendingAsset("Cover Background (Seamless)", step.id, step.type, "background");
        const bgUrl = await gemini.generateStepImage(
          { ...step, coverPart: "background" } as any,
          ruleTexts,
          config,
          previousImage,
          characterRef || undefined
        );
        updateStep(step.id, { generatedImageUrl: bgUrl });
        replacePendingAsset(pendingId, bgUrl, step.prompt);
      } else if (step.type === "title") {
        setGenerationPhase("title");
        const pendingId = addPendingAsset("Book Title Page", step.id, step.type);
        const imageUrl = await gemini.generateStepImage(
          step,
          ruleTexts,
          config,
          previousImage,
          characterRef || undefined
        );
        updateStep(step.id, { generatedImageUrl: imageUrl });
        replacePendingAsset(pendingId, imageUrl, step.bookTitle || "Book Title");
      } else {
        setGenerationPhase("scene");
        const label =
          step.type === "last"
            ? "Last Spread"
            : step.type === "first"
            ? "Spread 1 Artwork"
            : `Spread ${stepIndex - 1} Artwork`;
        const pendingId = addPendingAsset(label, step.id, step.type);
        const imageUrl = await gemini.generateStepImage(
          step,
          ruleTexts,
          config,
          previousImage,
          characterRef || undefined
        );
        updateStep(step.id, { generatedImageUrl: imageUrl });
        replacePendingAsset(pendingId, imageUrl, step.prompt);
      }

      setSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, status: "completed" } : s)));
      setGenerationPhase("idle");
    } catch (err: any) {
      setSteps((prev) =>
        prev.map((s) => (s.id === stepId ? { ...s, status: "error", error: err.message } : s))
      );
      setGenerationPhase("idle");
    }
  };

  const downloadImage = async (url: string, label: string) => {
    const filename = `${label.replace(/\s+/g, "_")}_${Date.now()}.png`;
    if (url.startsWith("data:")) {
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      return;
    }
    try {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) throw new Error("Fetch failed");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 100);
    } catch {
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.target = "_blank";
      link.rel = "noopener";
      link.click();
    }
  };

  const downloadAll = () => {
    assets
      .filter((a) => !a.isPending && a.url)
      .forEach((asset, idx) => {
        setTimeout(() => downloadImage(asset.url, asset.label), idx * 300);
      });
  };

  // ----------------- REGENERATION CODE (UNCHANGED) -----------------
  const handleRegenerateAsset = async (asset: RenderedAsset) => {
    if (!asset.stepId || !regenerateEditPrompt.trim()) return;

    const isAnyRegenerating = assets.some((a) => a.isPending);
    if (isAnyRegenerating) return;
    if (regeneratingAssetId !== asset.id) return;

    setRegeneratingAssetId(asset.id);

    try {
      const stepIndex = steps.findIndex((s) => s.id === asset.stepId);
      if (stepIndex === -1) {
        setRegeneratingAssetId(null);
        return;
      }

      setAssets((prev) => prev.map((a) => (a.id === asset.id ? { ...a, isPending: true } : a)));

      const step = steps[stepIndex];

      const gemini = getGemini();
      const ruleTexts = rules.map((r) => r.text).filter((t) => t.trim().length > 0);

      const basePrompt = asset.originalPrompt
        ? `${asset.originalPrompt}. EDIT REQUEST: ${regenerateEditPrompt.trim()}.`
        : regenerateEditPrompt.trim();
      const enhancedPrompt = `${basePrompt} [Edit variation: ${Date.now()}]`;

      let referenceImageBase64: string | undefined;
      if (asset.url && asset.url.startsWith("data:")) {
        referenceImageBase64 = asset.url;
      } else if (asset.url) {
        try {
          const response = await fetch(asset.url);
          const blob = await response.blob();
          referenceImageBase64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
        } catch {}
      }

      let newUrl: string;

      if (asset.coverPart) {
        const stepWithEdit = { ...step };
        if (asset.coverPart === "title") {
          // @ts-ignore
          stepWithEdit.bookTitle = enhancedPrompt;
        } else if (asset.coverPart === "cast") {
          // @ts-ignore
          stepWithEdit.cast = enhancedPrompt;
        } else {
          stepWithEdit.prompt = enhancedPrompt;
        }

        newUrl = await gemini.generateStepImage(
          { ...stepWithEdit, coverPart: asset.coverPart } as any,
          ruleTexts,
          config,
          undefined,
          characterRef || undefined,
          referenceImageBase64
        );

        if (asset.coverPart === "background") updateStep(step.id, { generatedImageUrl: newUrl });
        else if (asset.coverPart === "title") updateStep(step.id, { generatedTitleUrl: newUrl });
        else if (asset.coverPart === "cast") updateStep(step.id, { generatedCastUrl: newUrl });
      } else {
        newUrl = await gemini.generateStepImage(
          { ...step, prompt: enhancedPrompt },
          ruleTexts,
          config,
          undefined,
          characterRef || undefined,
          referenceImageBase64
        );
        updateStep(step.id, { generatedImageUrl: newUrl });
      }

      setAssets((prev) =>
        prev.map((a) =>
          a.id === asset.id
            ? {
                ...a,
                url: newUrl,
                timestamp: Date.now(),
                originalPrompt: enhancedPrompt,
                isPending: false,
              }
            : a
        )
      );

      setRegenerateEditPrompt("");
      setRegeneratingAssetId(null);
    } catch (error) {
      console.error("Error regenerating asset:", error);
      setAssets((prev) => prev.map((a) => (a.id === asset.id ? { ...a, isPending: false } : a)));
      setRegeneratingAssetId(null);
      setRegenerateEditPrompt("");
    }
  };

  const handleQuickRegenerate = async (asset: RenderedAsset) => {
    if (!asset.stepId) return;

    const isAnyRegenerating = assets.some((a) => a.isPending);
    if (isAnyRegenerating) return;

    setAssets((prev) => prev.map((a) => (a.id === asset.id ? { ...a, isPending: true } : a)));

    try {
      const stepIndex = steps.findIndex((s) => s.id === asset.stepId);
      if (stepIndex === -1) {
        setAssets((prev) => prev.map((a) => (a.id === asset.id ? { ...a, isPending: false } : a)));
        return;
      }

      const step = steps[stepIndex];
      const gemini = getGemini();
      const ruleTexts = rules.map((r) => r.text).filter((t) => t.trim().length > 0);

      const originalPrompt = asset.originalPrompt || step.prompt;

      let newUrl: string;

      if (asset.coverPart) {
        newUrl = await gemini.generateStepImage(
          { ...step, coverPart: asset.coverPart } as any,
          ruleTexts,
          config,
          undefined,
          characterRef || undefined
        );

        if (asset.coverPart === "background") updateStep(step.id, { generatedImageUrl: newUrl });
        else if (asset.coverPart === "title") updateStep(step.id, { generatedTitleUrl: newUrl });
        else if (asset.coverPart === "cast") updateStep(step.id, { generatedCastUrl: newUrl });
      } else {
        const promptWithRandom = `${originalPrompt} [Random variation: ${Date.now()}]`;
        newUrl = await gemini.generateStepImage(
          { ...step, prompt: promptWithRandom },
          ruleTexts,
          config,
          undefined,
          characterRef || undefined
        );
        updateStep(step.id, { generatedImageUrl: newUrl });
      }

      setAssets((prev) =>
        prev.map((a) =>
          a.id === asset.id ? { ...a, url: newUrl, timestamp: Date.now(), isPending: false } : a
        )
      );
    } catch (error) {
      console.error("Error quick regenerating asset:", error);
      setAssets((prev) => prev.map((a) => (a.id === asset.id ? { ...a, isPending: false } : a)));
    }
  };
  // ----------------- END REGENERATION CODE -----------------

  // ---------- Layout Room actions ----------
  const eligibleAssetsForStep = useMemo(() => {
    const map = new Map<string, RenderedAsset[]>();
    for (const a of assets) {
      if (!a.stepId || a.isPending || !a.url) continue;
      const arr = map.get(a.stepId) ?? [];
      arr.push(a);
      map.set(a.stepId, arr);
    }
    for (const [k, arr] of map.entries()) {
      arr.sort((x, y) => y.timestamp - x.timestamp);
      map.set(k, arr);
    }
    return map;
  }, [assets]);

  /**
   * ✅ FIX: Typography is STYLE-ONLY. It NEVER rewrites text.
   * We force exact headline/body from spread.text and build blocks deterministically.
   */
  const generateTypographyForSpread = async (spread: SpreadComposeItem) => {
    if (spread.textSide === "none") return;
    setLayoutBusyId(spread.id);

    try {
      const { width, height } = getOutputDimensions();
      const { headline, subtitle } = splitHeadlineAndBody(spread.text);
      const styleKey = spread.styleKey || styleKeyForSpread(spread.spreadNumber);

      const baseSpec: TypographySpec = {
        side: spread.textSide,
        overlay: { type: "gradient", strength: 0.72 },
        blocks: [],
      };

      const normalized = normalizeTypographySpec(
        baseSpec,
        spread.spreadNumber,
        width,
        height,
        { headline, subtitle }
      );

      updateLayoutSpread(spread.id, {
        typography: normalized,
        styleKey,
        textOffset: spread.textOffset ?? { x: 0, y: 0 },
      });
    } catch (e: any) {
      alert(`Typography generation failed: ${e?.message ?? e}`);
    } finally {
      setLayoutBusyId(null);
    }
  };

  const composeImageForSpread = async (spread: SpreadComposeItem) => {
    if (spread.textSide === "none") return;
    if (!spread.imageAssetId) return;
    if (!spread.typography) return;

    const asset = assets.find((a) => a.id === spread.imageAssetId);
    if (!asset?.url) return;

    setLayoutBusyId(spread.id);

    try {
      const { width, height } = getOutputDimensions();

      // Force exact text again at compose-time (guarantees no mismatch)
      const { headline, subtitle } = splitHeadlineAndBody(spread.text);
      const normalized = normalizeTypographySpec(
        spread.typography,
        spread.spreadNumber,
        width,
        height,
        { headline, subtitle }
      );

      const out = await composeSpreadImage(
        asset.url,
        normalized,
        width,
        height,
        spread.textOffset,
        spread.textAlign || "left",
        spread.textScale || 1,
        spread.lineGap || 1
      );
      updateLayoutSpread(spread.id, { composedDataUrl: out, typography: normalized });
    } catch (e: any) {
      alert(`Compose failed: ${e?.message ?? e}`);
    } finally {
      setLayoutBusyId(null);
    }
  };

  const downloadComposed = async (spread: SpreadComposeItem) => {
    if (!spread.composedDataUrl) return;
    await downloadImage(spread.composedDataUrl, `Spread_${spread.spreadNumber}_COMPOSED`);
  };

  // ----------------- UI -----------------
  return (
    <div className="min-h-screen flex flex-col p-4 md:p-8 max-w-[1750px] mx-auto gap-8">
      {/* Studio Header */}
      <header className="flex flex-col gap-6 pb-6 border-b border-white/5">
        <div className="flex flex-col lg:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-xl font-black font-display tracking-tight text-white uppercase italic leading-none">
                Nano Canvas
              </h1>
              <p className="text-slate-500 text-[7px] font-black uppercase tracking-[0.4em] mt-1">
                Professional Print Architecture
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {activeRoom !== "book" && (
              <button
                onClick={() => {
                  setSteps(createInitialSteps());
                  setAssets([]);
                  setLayoutSpreads([]);
                  setSelectedAssetForPreview(null);
                }}
                className="text-[8px] font-bold text-slate-500 hover:text-white uppercase tracking-widest transition-colors"
              >
                New Session
              </button>
            )}
          </div>
        </div>

        {/* Room Selector Menu */}
        <div className="flex items-center gap-2 justify-between w-full">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveRoom("book")}
              className={`px-6 py-2 rounded-lg font-black text-[9px] uppercase tracking-widest transition-all ${
                activeRoom === "book"
                  ? "bg-blue-600 text-white shadow-lg shadow-blue-500/20"
                  : "bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700"
              }`}
            >
              Book Generator
            </button>
            <button
              onClick={() => setActiveRoom("image")}
              className={`px-6 py-2 rounded-lg font-black text-[9px] uppercase tracking-widest transition-all ${
                activeRoom === "image"
                  ? "bg-blue-600 text-white shadow-lg shadow-blue-500/20"
                  : "bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700"
              }`}
            >
              Image Room
            </button>
            <button
              onClick={() => {
                if (layoutSpreads.length === 0) openLayoutRoom();
                else setActiveRoom("layout");
              }}
              className={`px-6 py-2 rounded-lg font-black text-[9px] uppercase tracking-widest transition-all ${
                activeRoom === "layout"
                  ? "bg-blue-600 text-white shadow-lg shadow-blue-500/20"
                  : "bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700"
              }`}
              title="Compose final spreads with typography"
            >
              Layout Room
            </button>
          </div>

          <div className="flex items-center gap-2">
            {activeRoom === "image" && (
              <button
                onClick={openLayoutRoom}
                className="px-4 py-2 rounded-lg font-black text-[9px] uppercase tracking-widest transition-all bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-500/10"
                title="Transfer Story TEXT + Images into Layout Room"
              >
                Transfer to Layout
              </button>
            )}

            {/* Saved Content Button */}
            <button
              onClick={() => setShowSavedProjects(true)}
              className="p-2 rounded-lg font-black transition-all bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 flex items-center justify-center"
              title="Saved Content"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
                />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* ROOMS */}
      {activeRoom === "book" ? (
        <div className="w-full">
          <BookGenerator
            key={bookGeneratorKey}
            onTransferToImageRoom={(outputs, input, selectedTitle) => {
              transferAllTextToImageRoom(outputs, input, selectedTitle);
              setActiveRoom("image");
            }}
          />
        </div>
      ) : activeRoom === "layout" ? (
        // ---------------- LAYOUT ROOM ----------------
        <div className="glass-panel rounded p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-black text-white uppercase tracking-widest">Layout Room</h2>
              <p className="text-[9px] text-slate-500 mt-1">
                Pick image + choose text side + typography (style only) + compose final PNG.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={openLayoutRoom}
                className="px-4 py-2 rounded-lg font-black text-[9px] uppercase tracking-widest bg-slate-800 hover:bg-slate-700 text-white"
                title="Rebuild from latest Story TEXT + Assets"
              >
                Rebuild From Latest
              </button>
              <button
                onClick={() => {
                  const run = async () => {
                    for (const s of layoutSpreads) {
                      if (!s.imageAssetId || s.textSide === "none" || !s.typography) continue;
                      await composeImageForSpread(s);
                    }
                  };
                  run();
                }}
                className="px-4 py-2 rounded-lg font-black text-[9px] uppercase tracking-widest bg-blue-600 hover:bg-blue-500 text-white"
              >
                Compose All Ready
              </button>
            </div>
          </div>

          {layoutSpreads.length === 0 ? (
            <div className="py-10 text-center text-slate-500 text-[10px]">
              No spreads found. Click <span className="text-white font-black">Rebuild From Latest</span>.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {layoutSpreads.map((s) => {
                const stepAssets = s.stepId ? eligibleAssetsForStep.get(s.stepId) ?? [] : [];
                const selectedAsset = s.imageAssetId ? assets.find((a) => a.id === s.imageAssetId) : undefined;
                const busy = layoutBusyId === s.id;

                const sk = s.styleKey || styleKeyForSpread(s.spreadNumber);
                const pal = paletteForKey(sk);
                const { width: outputW, height: outputH } = getOutputDimensions();
                const textBox =
                  s.typography && s.textSide !== "none"
                    ? getTextBox(s.typography, outputW, outputH, s.textOffset)
                    : null;

                return (
                  <div key={s.id} className="bg-slate-900/40 border border-white/5 rounded-lg p-4 space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-[10px] font-black text-white uppercase tracking-widest">
                          Spread {s.spreadNumber}
                        </div>
                        <div className="text-[8px] text-slate-500 uppercase tracking-widest mt-1">
                          Step linked: {s.stepId ? "yes" : "no"} • Assets: {stepAssets.length}
                        </div>

                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-[8px] text-slate-500 uppercase tracking-widest">Style:</span>
                          <span className="inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-widest text-slate-300">
                            {sk}
                          </span>
                          <span
                            className="w-2.5 h-2.5 rounded-full border border-white/10"
                            style={{ background: pal.primary }}
                            title="Primary"
                          />
                          <span
                            className="w-2.5 h-2.5 rounded-full border border-white/10"
                            style={{ background: pal.secondary }}
                            title="Secondary"
                          />
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <select
                            value={s.textSide}
                            onChange={(e) =>
                              updateLayoutSpread(s.id, {
                                textSide: e.target.value as any,
                                typography: undefined,
                                composedDataUrl: undefined,
                                textOffset: { x: 0, y: 0 },
                              })
                            }
                            className="bg-slate-800 border border-white/10 text-white text-[9px] rounded px-2 py-1"
                          >
                            <option value="none">No text</option>
                            <option value="left">Text left</option>
                            <option value="right">Text right</option>
                            <option value="center">Text center</option>
                          </select>

                          <button
                            onClick={() => generateTypographyForSpread(s)}
                            disabled={busy || s.textSide === "none"}
                            className={`px-3 py-1 rounded font-black text-[8px] uppercase tracking-widest ${
                              busy || s.textSide === "none"
                                ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                                : "bg-emerald-600 hover:bg-emerald-500 text-white"
                            }`}
                          >
                            {busy ? "Working..." : "Typography"}
                          </button>

                          <button
                            onClick={() =>
                              updateLayoutSpread(s.id, {
                                textOffset: { x: 0, y: 0 },
                                composedDataUrl: undefined,
                              })
                            }
                            disabled={s.textSide === "none"}
                            className={`px-3 py-1 rounded font-black text-[8px] uppercase tracking-widest ${
                              s.textSide === "none"
                                ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                                : "bg-slate-700 hover:bg-slate-600 text-white"
                            }`}
                            title="Reset text position"
                          >
                            Reset Pos
                          </button>

                          <button
                            onClick={() => composeImageForSpread(s)}
                            disabled={busy || !s.imageAssetId || !s.typography || s.textSide === "none"}
                            className={`px-3 py-1 rounded font-black text-[8px] uppercase tracking-widest ${
                              busy || !s.imageAssetId || !s.typography || s.textSide === "none"
                                ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                                : "bg-blue-600 hover:bg-blue-500 text-white"
                            }`}
                          >
                            {busy ? "..." : "Compose PNG"}
                          </button>
                        </div>

                        {s.textSide !== "none" && (
                          <div className="space-y-2 bg-slate-950/40 border border-white/10 rounded p-3">
                            <div className="space-y-2">
                              <label className="text-[8px] font-black text-slate-300 uppercase tracking-widest block">
                                Text Alignment
                              </label>
                              <div className="flex items-center gap-1">
                                {(["left", "center", "right"] as const).map((align) => (
                                  <button
                                    key={align}
                                    onClick={() =>
                                      updateLayoutSpread(s.id, {
                                        textAlign: align,
                                        composedDataUrl: undefined,
                                      })
                                    }
                                    className={`flex-1 py-1.5 rounded font-black text-[8px] uppercase tracking-widest transition-all ${
                                      (s.textAlign || "left") === align
                                        ? "bg-blue-600 text-white border border-blue-500"
                                        : "bg-slate-800 text-slate-400 border border-white/10 hover:border-white/20"
                                    }`}
                                    title={`Align text to ${align}`}
                                  >
                                    {align === "left" && "⬅"}
                                    {align === "center" && "⬇"}
                                    {align === "right" && "➡"}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div className="space-y-2">
                              <label className="text-[8px] font-black text-slate-300 uppercase tracking-widest block flex items-center justify-between">
                                <span>Text Size</span>
                                <span className="text-blue-400">{Math.round((s.textScale || 1) * 100)}%</span>
                              </label>
                              <input
                                type="range"
                                min="0.7"
                                max="1.4"
                                step="0.05"
                                value={s.textScale || 1}
                                onChange={(e) =>
                                  updateLayoutSpread(s.id, {
                                    textScale: parseFloat(e.target.value),
                                    composedDataUrl: undefined,
                                  })
                                }
                                className="w-full h-1.5 bg-slate-800 rounded appearance-none cursor-pointer accent-blue-600"
                              />
                              <div className="flex justify-between text-[7px] text-slate-500">
                                <span>70%</span>
                                <span>100%</span>
                                <span>140%</span>
                              </div>
                            </div>

                            <div className="space-y-2">
                              <label className="text-[8px] font-black text-slate-300 uppercase tracking-widest block flex items-center justify-between">
                                <span>Line Gap</span>
                                <span className="text-blue-400">{Math.round((s.lineGap || 1) * 100)}%</span>
                              </label>
                              <input
                                type="range"
                                min="0.7"
                                max="1.5"
                                step="0.05"
                                value={s.lineGap || 1}
                                onChange={(e) =>
                                  updateLayoutSpread(s.id, {
                                    lineGap: parseFloat(e.target.value),
                                    composedDataUrl: undefined,
                                  })
                                }
                                className="w-full h-1.5 bg-slate-800 rounded appearance-none cursor-pointer accent-green-600"
                              />
                              <div className="flex justify-between text-[7px] text-slate-500">
                                <span>Tight</span>
                                <span>Normal</span>
                                <span>Loose</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <textarea
                      value={s.text}
                      onChange={(e) =>
                        updateLayoutSpread(s.id, {
                          text: e.target.value,
                          typography: undefined,
                          composedDataUrl: undefined,
                        })
                      }
                      className="w-full bg-slate-950/60 border border-white/10 rounded p-3 text-[10px] text-slate-200 leading-relaxed resize-none min-h-[90px]"
                      placeholder="Story text for this spread..."
                    />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest">
                          Select image (for this spread)
                        </div>
                        <select
                          value={s.imageAssetId ?? ""}
                          onChange={(e) =>
                            updateLayoutSpread(s.id, {
                              imageAssetId: e.target.value || undefined,
                              composedDataUrl: undefined,
                            })
                          }
                          className="w-full bg-slate-800 border border-white/10 text-white text-[9px] rounded px-2 py-2"
                        >
                          <option value="">— Choose —</option>
                          {stepAssets.map((a) => (
                            <option key={a.id} value={a.id}>
                              {new Date(a.timestamp).toLocaleTimeString()} • {a.label}
                            </option>
                          ))}
                        </select>

                        <div className="aspect-video w-full rounded overflow-hidden bg-black border border-white/5">
                          {selectedAsset?.url ? (
                            <div className="w-full h-full relative">
                              <img src={selectedAsset.url} className="w-full h-full object-cover" alt="Selected" />
                              {textBox && s.typography && (
                                <div className="absolute inset-0">
                                  <div
                                    className="absolute border border-dashed border-blue-400/70 bg-blue-500/10 text-blue-100 text-[9px] font-black uppercase tracking-widest flex items-center justify-center cursor-move select-none"
                                    style={{
                                      left: `${(textBox.x0 / outputW) * 100}%`,
                                      top: `${(textBox.y0 / outputH) * 100}%`,
                                      width: `${(textBox.boxW / outputW) * 100}%`,
                                      height: `${(textBox.boxH / outputH) * 100}%`,
                                    }}
                                    onMouseDown={(e) =>
                                      beginTextDrag(s.id, e, outputW, outputH, s.textOffset)
                                    }
                                    title="Drag to reposition text"
                                  >
                                    Text
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-600 text-[9px] uppercase tracking-widest">
                              No image selected
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest">
                          Output (composed)
                        </div>

                        <div className="aspect-video w-full rounded overflow-hidden bg-black border border-white/5 relative">
                          {s.composedDataUrl ? (
                            <img src={s.composedDataUrl} className="w-full h-full object-cover" alt="Composed" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-600 text-[9px] uppercase tracking-widest">
                              Not composed yet
                            </div>
                          )}

                          {busy && (
                            <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                              <div className="w-10 h-10 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => downloadComposed(s)}
                            disabled={!s.composedDataUrl}
                            className={`flex-1 px-3 py-2 rounded font-black text-[8px] uppercase tracking-widest ${
                              !s.composedDataUrl
                                ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                                : "bg-white text-slate-900 hover:bg-slate-200"
                            }`}
                          >
                            Download composed
                          </button>

                          <button
                            onClick={() =>
                              updateLayoutSpread(s.id, {
                                typography: undefined,
                                composedDataUrl: undefined,
                                textOffset: { x: 0, y: 0 },
                                textAlign: "left",
                                textScale: 1,
                                lineGap: 1,
                              })
                            }
                            className="px-3 py-2 rounded font-black text-[8px] uppercase tracking-widest bg-slate-800 hover:bg-slate-700 text-white"
                            title="Clear typography + composed output"
                          >
                            Reset
                          </button>
                        </div>

                        <div className="text-[8px] text-slate-500 leading-relaxed">
                          Tip: Edit text → run <span className="text-white font-black">Typography</span> again (it keeps
                          your exact text, renders everything in white, and varies layout per page).
                        </div>
                      </div>
                    </div>

                    {s.typography && (
                      <details className="bg-slate-950/40 border border-white/10 rounded p-3">
                        <summary className="cursor-pointer text-[9px] font-black text-slate-300 uppercase tracking-widest">
                          Typography JSON
                        </summary>
                        <pre className="text-[9px] text-slate-300 overflow-x-auto mt-2">
                          {JSON.stringify(s.typography, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        // ---------------- IMAGE ROOM ----------------
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1 overflow-hidden">
          {/* Sidebar Controls */}
          <div className="lg:col-span-3 flex flex-col gap-6 overflow-y-auto custom-scrollbar pr-2">
            <div className="glass-panel p-6 rounded space-y-6">
              <h2 className="text-[8px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <div className="w-1 h-1 rounded-full bg-blue-500" />
                Global Constants
              </h2>
              <p className="text-[7px] text-slate-500 -mt-2">Gemini 3 Pro Image Preview</p>

              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-1">
                  {(["16:9", "21:9", "4:3", "1:1"] as AspectRatio[]).map((ratio) => (
                    <button
                      key={ratio}
                      onClick={() => setConfig((c) => ({ ...c, aspectRatio: ratio }))}
                      className={`py-1.5 text-[8px] font-black rounded border transition-all ${
                        config.aspectRatio === ratio
                          ? "bg-blue-600 border-blue-500 text-white"
                          : "bg-slate-900/50 border-white/5 text-slate-500 hover:border-white/20"
                      }`}
                    >
                      {ratio}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {(["1K", "2K", "4K"] as const).map((sz) => (
                    <button
                      key={sz}
                      onClick={() => setConfig((c) => ({ ...c, imageSize: sz }))}
                      className={`py-1 px-2 text-[8px] font-black rounded border transition-all ${
                        config.imageSize === sz
                          ? "bg-slate-600 border-slate-500 text-white"
                          : "bg-slate-900/50 border-white/5 text-slate-500 hover:border-white/20"
                      }`}
                    >
                      {sz}
                    </button>
                  ))}
                  <span className="py-1.5 px-2.5 rounded bg-blue-600 text-white text-[8px] font-black tabular-nums">
                    {(() => {
                      const { width, height } = getOutputDimensions();
                      return `${width}×${height}`;
                    })()}
                  </span>
                </div>

                <div
                  className="flex items-center justify-between p-3 bg-slate-900/50 rounded border border-white/5 group cursor-pointer"
                  onClick={() => setConfig((c) => ({ ...c, demographicExclusion: !c.demographicExclusion }))}
                >
                  <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">
                    Demographic exclusion
                  </span>
                  <div
                    className={`w-7 h-3.5 rounded-full p-0.5 transition-all ${
                      config.demographicExclusion ? "bg-blue-600" : "bg-slate-800"
                    }`}
                  >
                    <div
                      className={`w-2.5 h-2.5 bg-white rounded-full transition-transform ${
                        config.demographicExclusion ? "translate-x-3.5" : ""
                      }`}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="glass-panel p-6 rounded space-y-4">
              <h2 className="text-[8px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <div className="w-1 h-1 rounded-full bg-orange-500" />
                Master Photo
              </h2>
              <div className="relative aspect-video rounded border-none overflow-hidden transition-all cursor-pointer bg-slate-900">
                <input
                  type="file"
                  className="absolute inset-0 opacity-0 cursor-pointer z-10"
                  onChange={handleCharacterUpload}
                />
                {characterRef ? (
                  <img src={characterRef} className="w-full h-full object-cover" alt="Hero Ref" />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center opacity-40 hover:opacity-100 transition-opacity">
                    <svg className="w-5 h-5 mb-2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    <span className="text-[8px] font-black uppercase tracking-widest">Protagonist Reference</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Story Timeline */}
          <div className="lg:col-span-4 flex flex-col overflow-y-auto custom-scrollbar pr-2">
            <div className="flex items-center justify-between px-2 mb-6">
              <h2 className="text-xs font-black text-white uppercase tracking-widest">Story Timeline</h2>
              <button
                onClick={addSpread}
                className="w-8 h-8 rounded bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center transition-all active:scale-90 shadow-lg shadow-blue-500/10"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>

            <div className="flex flex-col gap-3">
              {steps.map((step, idx) => (
                <StepInput
                  key={step.id}
                  index={idx}
                  step={step}
                  spreadNumber={getSpreadNumber(step, steps)}
                  onUpdate={updateStep}
                  onDelete={step.type === "middle" ? deleteStep : undefined}
                  onGenerateTitle={step.type === "title" ? handleGenerateTitle : undefined}
                  onGenerate={
                    (step.prompt.trim() || step.type === "title") && !isProcessActive
                      ? () => handleGenerateSingleStep(step.id)
                      : undefined
                  }
                  disabled={isProcessActive && !isPaused}
                  isSuggestingTitle={step.type === "title" && isSuggestingTitle}
                />
              ))}
            </div>
          </div>

          {/* Master Monitor & Assets Stack */}
          <div className="lg:col-span-5 flex flex-col gap-8 overflow-y-auto custom-scrollbar">
            {/* Initiate Render Button */}
            <div className="flex justify-end gap-2">
              {isProcessActive ? (
                <>
                  {isPaused ? (
                    <button
                      onClick={handleResume}
                      className="px-6 py-4 rounded-lg font-black text-[10px] uppercase tracking-widest transition-all bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20 active:scale-95"
                    >
                      Resume
                    </button>
                  ) : (
                    <button
                      onClick={handlePause}
                      className="px-6 py-4 rounded-lg font-black text-[10px] uppercase tracking-widest transition-all bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-600/20 active:scale-95"
                    >
                      Pause
                    </button>
                  )}
                  <button
                    onClick={handleStop}
                    className="px-6 py-4 rounded-lg font-black text-[10px] uppercase tracking-widest transition-all bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/20 active:scale-95"
                  >
                    Stop
                  </button>
                </>
              ) : (
                <button
                  onClick={startNarrativeFlow}
                  disabled={activeQueueSteps.length === 0}
                  className={`w-1/3 px-6 py-4 rounded-lg font-black text-[10px] uppercase tracking-widest transition-all ${
                    activeQueueSteps.length === 0
                      ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                      : "bg-[#3355FF] hover:bg-[#2a44cc] text-white shadow-lg shadow-[#3355FF]/20 active:scale-95"
                  }`}
                >
                  INITIATE RENDER
                </button>
              )}
            </div>

            {/* Monitor */}
            <div className="glass-panel rounded p-6 md:p-8 flex flex-col relative shrink-0 overflow-hidden">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-black text-white uppercase tracking-tighter">Master Monitor</h3>
                {awaitingApproval && (
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleApproval}
                      className="px-5 py-1.5 bg-emerald-600 text-white text-[8px] font-black rounded uppercase hover:bg-emerald-500 active:scale-95 shadow shadow-emerald-600/10"
                    >
                      Approve & Next
                    </button>
                  </div>
                )}
              </div>

              <div className="flex-1 flex flex-col items-center justify-center text-center">
                {!currentActiveStep ? (
                  <div className="opacity-10 py-16">
                    <h4 className="text-sm font-black uppercase tracking-[0.6em] text-slate-400">Idle Pipeline</h4>
                  </div>
                ) : (
                  <div className="w-full space-y-6">
                    <div
                      className="relative aspect-video w-full rounded-sm overflow-hidden bg-slate-950"
                      style={{ aspectRatio: config.aspectRatio.replace(":", "/") }}
                    >
                      {currentActiveStep.status === "generating" ? (
                        <div className="absolute inset-0 bg-slate-950/98 flex flex-col items-center justify-center gap-6 z-50">
                          <div className="w-12 h-12 border-2 border-blue-500/10 border-t-blue-500 rounded-full animate-spin" />
                          <span className="text-[9px] font-black text-blue-500 uppercase tracking-[0.7em] animate-pulse">
                            Synchronizing: {generationPhase.toUpperCase()}
                          </span>
                        </div>
                      ) : (
                        <>
                          {currentActiveStep.generatedImageUrl && (
                            <img
                              src={currentActiveStep.generatedImageUrl}
                              className="w-full h-full object-cover"
                              alt="Render Output"
                            />
                          )}
                          {currentActiveStep.type !== "cover" && currentActiveStep.textSide !== "none" && (
                            <div
                              className={`absolute inset-0 pointer-events-none transition-all duration-1000 ${
                                currentActiveStep.textSide === "left"
                                  ? "bg-gradient-to-r from-black/80 via-black/20 to-transparent"
                                  : "bg-gradient-to-l from-black/80 via-black/20 to-transparent"
                              }`}
                            />
                          )}
                        </>
                      )}
                    </div>

                    <div className="max-w-xl mx-auto px-4">
                      <p className="text-[10px] text-slate-400 font-medium italic leading-relaxed">
                        "{currentActiveStep.prompt || "Synthesizing..."}"
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Assets Stack (compact) */}
            <div className="glass-panel rounded p-6 flex flex-col gap-4 shrink-0">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-tight">Assets Stack</h3>
                  <p className="text-[7px] text-slate-500 uppercase tracking-widest mt-1">
                    Export Components: {assets.length}
                  </p>
                </div>
                {assets.length > 0 && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={downloadAll}
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-[7px] font-black rounded uppercase tracking-widest shadow shadow-blue-500/10 transition-all"
                    >
                      Download Stack
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                {assets
                  .filter((a) => !a.isPending && a.url)
                  .slice(0, 6)
                  .map((a) => (
                    <button
                      key={a.id}
                      onClick={() => downloadImage(a.url, a.label)}
                      className="bg-slate-900/40 border border-white/5 rounded overflow-hidden text-left"
                      title="Download"
                    >
                      <div className="aspect-video bg-black">
                        <img src={a.url} className="w-full h-full object-cover" alt={a.label} />
                      </div>
                      <div className="p-2">
                        <div className="text-[8px] font-black text-slate-200 uppercase truncate">{a.label}</div>
                        <div className="text-[7px] text-slate-500 uppercase tracking-widest mt-1">
                          {new Date(a.timestamp).toLocaleTimeString()}
                        </div>
                      </div>
                    </button>
                  ))}
              </div>

              {assets.length > 6 && (
                <div className="text-[8px] text-slate-500">
                  Showing latest 6 assets here. Your full gallery UI can remain unchanged if you paste it back.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Saved Projects Modal */}
      {showSavedProjects && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setShowSavedProjects(false)}
        >
          <div
            className="glass-panel rounded-2xl p-6 max-w-md w-full mx-4 border border-white/10 max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-sm font-black text-white uppercase tracking-widest">Saved Projects</h3>
              <div className="flex items-center gap-3">
                <button
                  onClick={saveCurrentProject}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-black text-[9px] uppercase tracking-widest transition-all"
                >
                  Save Current
                </button>
                <button
                  onClick={() => setShowSavedProjects(false)}
                  className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-all"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-3">
              {savedProjects.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-xs text-slate-500 font-black uppercase tracking-widest">No saved projects</p>
                </div>
              ) : (
                savedProjects.map((project) => (
                  <div
                    key={project.id}
                    className="p-4 bg-slate-900/50 rounded-lg border border-white/5 hover:border-white/20 transition-all"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <h4 className="text-xs font-black text-white uppercase tracking-tight mb-1">{project.name}</h4>
                        <p className="text-[9px] text-slate-400">Saved {new Date(project.savedAt).toLocaleString()}</p>
                      </div>
                      <button
                        onClick={() => deleteProject(project.id)}
                        className="p-1.5 rounded-lg hover:bg-rose-500/10 text-slate-600 hover:text-rose-500 transition-all"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    </div>
                    <button
                      onClick={() => loadProject(project)}
                      className="w-full mt-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-black text-[9px] uppercase tracking-widest transition-all"
                    >
                      Load Project
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
