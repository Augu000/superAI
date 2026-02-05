import express from "express";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config({ path: ".env.local" });

const app = express();
const PORT = process.env.API_PORT || 5000;

app.use(cors());
app.use(express.json({ limit: "50mb" }));

const IMAGE_MODEL = "gemini-3-pro-image-preview";
const TEXT_MODEL = "gemini-3-flash-preview";

function safeJsonParse<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function normalizeSide(side: unknown): "left" | "right" | "center" | null {
  if (side === "left" || side === "right" || side === "center") return side;
  return null;
}

type TypographySpec = {
  side: "left" | "right" | "center";
  overlay: { type: "gradient"; strength: number };
  blocks: Array<
    | {
        kind: "headline";
        text: string;
        uppercase?: boolean;
        size: number;
        color: string;
        weight: 800;
        letterSpacing: number;
      }
    | {
        kind: "body";
        text: string;
        size: number;
        color: string;
        weight: 500;
        lineHeight: number;
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

function isHexColor(value: any) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

function asText(value: any) {
  return typeof value === "string" ? value : "";
}

function sanitizeSpec(
  input: any,
  strictText: string,
  side: "left" | "right"
): TypographySpec {
  const overlayStrength = clamp(Number(input?.overlay?.strength ?? 0.7), 0, 1);
  const blocksIn: any[] = Array.isArray(input?.blocks) ? input.blocks : [];
  const blocksOut: TypographySpec["blocks"] = [];

  for (const b of blocksIn) {
    const kind = b?.kind;
    if (kind !== "headline" && kind !== "body" && kind !== "emphasis") continue;

    if (kind === "headline") {
      blocksOut.push({
        kind,
        text: asText(b?.text),
        uppercase: Boolean(b?.uppercase),
        size: clamp(Number(b?.size ?? 64), 44, 72),
        color: isHexColor(b?.color) ? b.color : "#7CB2FF",
        weight: 800,
        letterSpacing: clamp(Number(b?.letterSpacing ?? 1), 0, 2),
      });
      continue;
    }

    if (kind === "body") {
      blocksOut.push({
        kind,
        text: asText(b?.text),
        size: clamp(Number(b?.size ?? 22), 18, 28),
        color: isHexColor(b?.color) ? b.color : "#E7EAF0",
        weight: 500,
        lineHeight: clamp(Number(b?.lineHeight ?? 1.35), 1.2, 1.6),
      });
      continue;
    }

    blocksOut.push({
      kind,
      text: asText(b?.text),
      uppercase: Boolean(b?.uppercase),
      size: clamp(Number(b?.size ?? 34), 24, 44),
      color: isHexColor(b?.color) ? b.color : "#FFB020",
      weight: 900,
    });
  }

  const hasBody = blocksOut.some((b) => b.kind === "body");
  if (!hasBody) {
    blocksOut.push({
      kind: "body",
      text: strictText,
      size: 22,
      color: "#E7EAF0",
      weight: 500,
      lineHeight: 1.35,
    });
  }

  for (const b of blocksOut) {
    if (!b.text?.trim()) {
      if (b.kind === "body") (b as any).text = strictText;
    }
  }

  return {
    side,
    overlay: { type: "gradient", strength: overlayStrength },
    blocks: blocksOut,
  };
}

function fallbackSpec(text: string, side: "left" | "right"): TypographySpec {
  return {
    side,
    overlay: { type: "gradient", strength: 0.75 },
    blocks: [
      {
        kind: "headline",
        text: "OSKARAS BUVO BERNIUKAS",
        uppercase: true,
        size: 64,
        color: "#7CB2FF",
        weight: 800,
        letterSpacing: 1,
      },
      {
        kind: "body",
        text,
        size: 22,
        color: "#E7EAF0",
        weight: 500,
        lineHeight: 1.35,
      },
      {
        kind: "emphasis",
        text: "NIEKADA NETILO GARSAI",
        uppercase: true,
        size: 36,
        color: "#FFB020",
        weight: 900,
      },
    ],
  };
}

app.post("/generate-image", async (req, res) => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "API_KEY not set" });
  }

  const {
    prompt,
    aspectRatio = "16:9",
    imageSize = "1K",
    previousImageBase64,
    characterRefBase64,
    referenceImageBase64,
  } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: "Prompt required" });
  }

  const parts: any[] = [];

  if (referenceImageBase64) {
    parts.push({
      inline_data: {
        data: referenceImageBase64.split(",")[1],
        mime_type: "image/png",
      },
    });
  }

  if (characterRefBase64) {
    parts.push({
      inline_data: {
        data: characterRefBase64.split(",")[1],
        mime_type: "image/png",
      },
    });
  }

  if (previousImageBase64 && !referenceImageBase64) {
    parts.push({
      inline_data: {
        data: previousImageBase64.split(",")[1],
        mime_type: "image/png",
      },
    });
  }

  parts.push({ text: prompt });

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
            imageConfig: {
              aspectRatio,
              imageSize,
            },
          },
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: err });
    }

    const data = await response.json();

    for (const part of data.candidates?.[0]?.content?.parts || []) {
      const img = part.inlineData?.data ?? part.inline_data?.data;
      if (img) {
        return res.json({
          image: `data:image/png;base64,${img}`,
        });
      }
    }

    return res.status(500).json({ error: "No image returned" });
  } catch (e: any) {
    console.error("Error generating image:", e);
    return res.status(500).json({ error: e.message || "Generation failed" });
  }
});

app.post("/generate-text", async (req, res) => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "API_KEY not set" });
  }

  const { prompt } = req.body || {};
  if (!prompt) {
    return res.status(400).json({ error: "Prompt is required" });
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent?key=${encodeURIComponent(
        apiKey
      )}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: err || `HTTP ${response.status}` });
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    return res.json({ text: String(text || "") });
  } catch (e: any) {
    console.error("Error generating text:", e);
    return res.status(500).json({ error: e.message || "Internal server error" });
  }
});

app.post("/analyze-story", async (req, res) => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "API_KEY not set" });
  }

  const { prompts } = req.body || {};
  if (!prompts || !Array.isArray(prompts)) {
    return res.status(400).json({ error: "Prompts array is required" });
  }

  const combined = prompts.filter((p: string) => p.trim().length > 0).join("\n");
  const promptText = `Analyze these narrative scenes and determine a catchy cinematic title and a specific visual style for the typography that matches the theme (e.g., "weathered pirate wood", "neon high-tech pulse", "medieval forged iron", "elegant victorian gold").\n\nNarrative Context:\n${combined}\n\nRespond with valid JSON: {"title": "...", "visualStyle": "..."}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent?key=${encodeURIComponent(
        apiKey
      )}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: err || `HTTP ${response.status}` });
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";

    try {
      const parsed = JSON.parse(rawText || "{}");
      return res.json({
        title: parsed.title || "A Nano Tale",
        visualStyle: parsed.visualStyle || "cinematic gold and light",
      });
    } catch {
      return res.json({
        title: "A Nano Tale",
        visualStyle: "cinematic gold and light",
      });
    }
  } catch (e: any) {
    console.error("Error analyzing story:", e);
    return res.status(500).json({ error: e.message || "Internal server error" });
  }
});

app.post("/generate-typography", async (req, res) => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "API_KEY not set" });
  }

  const text = (req.body?.text ?? "").toString();
  const side = normalizeSide(req.body?.side);
  if (!text.trim() || !side || side === "center") {
    return res
      .status(400)
      .json({ error: "text and side required (side must be 'left'|'right')" });
  }

  const prompt = `
You are a children's book typography designer.
Return VALID JSON ONLY (no markdown, no commentary).

CRITICAL TEXT RULE:
- The BODY block text MUST equal the input text EXACTLY (verbatim), including Lithuanian letters and punctuation.
- Headline and Emphasis must use ONLY words that already appear in the input text (no paraphrasing, no synonyms).
- You must not introduce any new words, even a single one.
- You must not change word forms.
If you cannot comply, return a JSON object with ONE body block containing the exact input text.

INPUT TEXT (Lithuanian) - use EXACTLY:
"""${text}"""

SIDE: ${side} (text must fit on this side)

STYLE RULES:
- Keep body color mostly white/gray.
- Use at most 2 accent colors total for headline/emphasis (kid-friendly).
- Overlay: gradient strength 0.6 - 0.9 for legibility.
- Sizes must stay in schema ranges.

JSON SCHEMA:
{
  "side": "left"|"right",
  "overlay": { "type":"gradient", "strength": 0.0-1.0 },
  "blocks": [
    { "kind":"headline", "text":"...", "uppercase":true|false, "size": 44-72, "color":"#RRGGBB", "weight":800, "letterSpacing": 0-2 },
    { "kind":"body", "text":"...", "size": 18-28, "color":"#RRGGBB", "weight":500, "lineHeight": 1.2-1.6 },
    { "kind":"emphasis", "text":"...", "uppercase":true|false, "size": 24-44, "color":"#RRGGBB", "weight":900 }
  ]
}
`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent?key=${encodeURIComponent(
        apiKey
      )}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.4,
          },
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: err || `HTTP ${response.status}` });
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    const parsed = safeJsonParse<any>(rawText);
    const spec = parsed ? sanitizeSpec(parsed, text, side) : fallbackSpec(text, side);

    for (const b of spec.blocks) {
      if (b.kind === "body") {
        (b as any).text = text;
        break;
      }
    }

    return res.json(spec);
  } catch (e: any) {
    console.error("Error generating typography:", e);
    return res.status(500).json({ error: e.message || "Internal server error" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Local API server running on http://localhost:${PORT}`);
});
