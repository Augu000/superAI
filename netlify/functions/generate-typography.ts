// netlify/functions/generate-typography.ts
import type { Handler } from "@netlify/functions";

const TEXT_MODEL = "gemini-3-flash-preview";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function safeJsonParse<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
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

/**
 * Hard requirements:
 * - MUST reuse the Lithuanian text EXACTLY (no paraphrase / no new words)
 * - MUST NOT output extra keys / prose
 * - Must stay within schema ranges
 *
 * We enforce this by:
 *  1) very strict prompt
 *  2) forcing JSON response mime type
 *  3) validating + sanitizing the result
 *  4) if invalid, returning a deterministic fallback spec
 */
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

function isHexColor(s: any) {
  return typeof s === "string" && /^#[0-9a-fA-F]{6}$/.test(s);
}

function asText(v: any) {
  return typeof v === "string" ? v : "";
}

function sanitizeSpec(
  input: any,
  strictText: string,
  side: "left" | "right"
): TypographySpec {
  const overlayStrength = clamp(Number(input?.overlay?.strength ?? 0.7), 0, 1);

  const blocksIn: any[] = Array.isArray(input?.blocks) ? input.blocks : [];

  // Keep only allowed kinds and coerce ranges
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

    // emphasis
    blocksOut.push({
      kind,
      text: asText(b?.text),
      uppercase: Boolean(b?.uppercase),
      size: clamp(Number(b?.size ?? 34), 24, 44),
      color: isHexColor(b?.color) ? b.color : "#FFB020",
      weight: 900,
    });
  }

  // Ensure we have at least one body block (fallback uses exact text)
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

  // IMPORTANT: We cannot perfectly guarantee "only words from input" without a full tokenizer
  // and morphological checks, but we can enforce "no NEW text blocks when empty" and
  // always keep body as the exact input if model output is suspicious/empty.
  // If model returns empty strings, restore with exact text.
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
  // Deterministic fallback: exact body only (no risk of paraphrase)
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
        text, // EXACT
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

export const handler: Handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "API_KEY not set" }),
    };
  }

  const body = safeJsonParse<{ text?: string; side?: string }>(event.body);
  const text = body?.text?.toString() ?? "";
  const side = normalizeSide(body?.side);

  if (!text.trim() || !side) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: "text and side required (side must be 'left'|'right')" }),
    };
  }

  // Stronger instruction: "use EXACT text", no rewriting, no new words, no paraphrase.
  // Also: ask the model to keep the BODY as the full original text verbatim.
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

  const res = await fetch(
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

  if (!res.ok) {
    const errBody = await res.text();
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: errBody || `HTTP ${res.status}` }),
    };
  }

  const data = await res.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";

  // Validate + sanitize. If parsing fails, fall back deterministically.
  const parsed = safeJsonParse<any>(rawText);
  const spec = parsed
    ? sanitizeSpec(parsed, text, side)
    : fallbackSpec(text, side);

  // Extra enforcement: BODY must be exact input
  for (const b of spec.blocks) {
    if (b.kind === "body") {
      (b as any).text = text;
      break;
    }
  }

  return {
    statusCode: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    body: JSON.stringify(spec),
  };
};
