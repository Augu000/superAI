// src/services/geminiService.ts
import type { AspectRatio, ImageSize } from "../types";

type StepType = "cover" | "first" | "middle" | "last" | "title";
type TextSide = "left" | "right" | "none";
type CoverPart = "background" | "title" | "cast";

// Use localhost:5000 for local dev, or relative path for production/netlify
const getApiBaseUrl = () => {
  if (typeof window !== "undefined" && (import.meta as any).env.DEV) {
    return "http://localhost:5000";
  }
  return "/.netlify/functions";
};

const NETLIFY_DEV_MSG =
  "Cannot reach the API. Run: npm run dev:local — then open http://localhost:5173 (Vite will run on port 5173).";

async function apiFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e: any) {
    const msg = e?.message || String(e);
    if (
      msg.includes("Failed to fetch") ||
      msg.includes("ERR_CONNECTION_REFUSED") ||
      msg.includes("Load failed")
    ) {
      throw new Error(NETLIFY_DEV_MSG);
    }
    throw e;
  }
}

/**
 * IMPORTANT:
 * - For SCENE / BACKGROUND artwork we must enforce a strict "NO TEXT" rule,
 *   otherwise the image model will hallucinate or paraphrase Lithuanian copy
 *   into the image (posters, captions, headlines, etc).
 * - Typography layers (title/cast/ending card) are allowed to contain text.
 */
const NO_TEXT_RULE = `
ABSOLUTE TEXT BAN (VERY IMPORTANT):
- NO TEXT, NO LETTERS, NO WORDS, NO NUMBERS
- NO TYPOGRAPHY, NO CAPTIONS, NO SUBTITLES, NO SPEECH BUBBLES
- NO SIGNS, NO POSTERS, NO BOOK COVERS, NO WALL DECALS WITH WORDS
- NO UI OVERLAYS, NO WATERMARKS, NO LOGOS WITH READABLE LETTERS
- NOTHING WRITTEN ON OBJECTS (shirts, toys, drums, stickers, notebooks, etc.)
The final image must contain ZERO readable text of any kind.
`;

/**
 * For safe "text side" in SCENE images: we only want lighting/space hints,
 * never actual rendered text. Layout Room will place the real text later.
 */
function getLegibilityHint(textSide: TextSide) {
  if (textSide === "left") {
    return `
LAYOUT / NEGATIVE SPACE:
- Keep the LEFT HALF cleaner and less detailed (soft background, fewer objects).
- Keep the main subject and highest contrast details on the RIGHT half.
- Add gentle vignette / darker gradient on the LEFT side for future overlay legibility.
`;
  }
  if (textSide === "right") {
    return `
LAYOUT / NEGATIVE SPACE:
- Keep the RIGHT HALF cleaner and less detailed (soft background, fewer objects).
- Keep the main subject and highest contrast details on the LEFT half.
- Add gentle vignette / darker gradient on the RIGHT side for future overlay legibility.
`;
  }
  return "";
}

export class GeminiService {
  constructor() {
    // No API key needed - handled server-side
  }

  /**
   * NEW: generic text generation helper for the BookTextService.
   * Returns plain text.
   */
  async generateText(prompt: string): Promise<string> {
    const response = await apiFetch(`${getApiBaseUrl()}/generate-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.text || "";
  }

  async analyzeStory(prompts: string[]): Promise<{ title: string; visualStyle: string }> {
    const response = await apiFetch(`${getApiBaseUrl()}/analyze-story`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompts }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    return {
      title: data.title || "A Nano Tale",
      visualStyle: data.visualStyle || "cinematic gold and light",
    };
  }

  async generateCastName(prompts: string[]): Promise<string> {
    const combined = prompts.filter((p) => p.trim().length > 0).join("\n");

    const response = await apiFetch(`${getApiBaseUrl()}/generate-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt:
          `Based on this story context, generate ONE character name (the hero/main character name) in 1-2 words maximum. ` +
          `Just return the name, nothing else.\n\nStory Context:\n${combined}`,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    return (data.text || "The Hero").trim().split(/\s+/).slice(0, 2).join(" ");
  }

  async generateStepImage(
    step: {
      prompt: string;
      type: StepType;
      textSide: TextSide;
      bookTitle?: string;
      cast?: string;
      storyStyle?: string;
      showText?: boolean;
      coverPart?: CoverPart;
    },
    globalRules: string[],
    config: {
      aspectRatio: AspectRatio;
      imageSize: ImageSize;
      bleedPercent: number;
      demographicExclusion?: boolean; // ignored if present
    },
    previousImageBase64?: string,
    characterRefBase64?: string,
    referenceImageBase64?: string
  ): Promise<string> {
    const cleanTitle = (step.bookTitle || "UNTITLED").replace(/[*#_>`]/g, "").trim();
    const cleanCast = (step.cast || "THE HERO").replace(/[*#_>`]/g, "").trim();
    // Unified visual style for all artwork (cover + spreads)
    const styleDescription =
      step.storyStyle ||
      "stylized 3D animated film look (Pixar-like), soft volumetric lighting, cinematic color grading";

    const ruleContext =
      globalRules.length > 0 ? `VISUAL STYLE REQUIREMENTS: ${globalRules.join(", ")}.` : "";

    // Base composition context
    let compositionContext = `COMPOSITION: ${config.aspectRatio} aspect ratio.`;

    // PROHIBIT ALL TECHNICAL LINES & ARTIFACTS
    compositionContext += `
  IMAGE QUALITY:
  1) NO TECHNICAL MARKS: Do not render borders, crop marks, safe zones, margins, bleed lines, guides, or bending lines.
  2) EDGE-TO-EDGE: Pure continuous artwork reaching all four corners (full-bleed).

  RENDERING MEDIUM & STYLE: ${styleDescription}.
  
  CHARACTER & ANIMAL CONSISTENCY (ABSOLUTELY CRITICAL):
  - The protagonist (child) must wear EXACTLY the same outfit, hair color, hair style, and facial features in EVERY image.
  - ALL animals/pets must maintain IDENTICAL species, breed, exact coat color, exact markings, exact fur pattern, exact size, and exact body morphology across EVERY image.
  - DO NOT change animal breed, color, or appearance under any circumstance (e.g., if a Golden Retriever appears once, it MUST be a Golden Retriever in all images with identical coat shade and all markings).
  - Props, background objects, environmental elements must remain consistent in shape, color, and material.
  - NO substitutions: do not swap in different animals, different colored variants, or different breed types.`;

    // Demographic exclusion (keeping your current behavior)
    if (config.demographicExclusion) {
      compositionContext += `
CHARACTER DEMOGRAPHICS: Do not include any characters with dark skin tones or Black people in this image.`;
    }

    // Identify layers where text IS allowed
    const isTypographyLayer =
      step.type === "last" ||
      step.type === "title" ||
      step.coverPart === "title" ||
      step.coverPart === "cast";

    // For any non-typography artwork, hard-append NO_TEXT_RULE
    const maybeNoText = isTypographyLayer ? "" : `\n${NO_TEXT_RULE}\n`;

    let finalPromptText = "";

    // ---------------- COVER ----------------
    if (step.type === "cover") {
      if (step.coverPart === "background") {
        finalPromptText = `
    ${ruleContext}
    ${compositionContext}

    LAYOUT: SEAMLESS WRAP-AROUND book cover background (single continuous landscape across front + back).
    ABSOLUTE PROHIBITION: DO NOT render any vertical lines, splitters, center dividers, spine creases, or bending marks.

    FRONT COVER (RIGHT HALF): Position characters and main focal points in the BOTTOM-RIGHT area only.
    NEGATIVE SPACE FOR TITLE: The TOP 70% of the right side must remain clear (soft sky/atmosphere) for later manual title placement.

    ===== RENDERING STYLE (ABSOLUTE CRITICAL) =====
    MANDATORY: Full 3D animated cinematic rendering ONLY.
    - Photorealistic 3D materials (cloth, skin, grass, wood, metal); absolutely NO illustration, NO hand-drawn, NO cartoon outlines or strokes.
    - Global illumination with realistic light bouncing, volumetric atmospheric effects, depth-of-field, lens blur.
    - PBR (physically-based rendering) shaders for consistent material appearance across all surfaces.
    - Character anatomy fully 3D-modeled with realistic proportions (NOT sketch-like, NOT stylized proportions).
    - Render quality IDENTICAL to interior spread pages (same model detail, same lighting temperature, same material finish).
    
    PROHIBITED COMPLETELY:
    - NO 2D digital painting, NO vector art, NO flat color fills.
    - NO illustration-style outlines, edges, or cel-shading.
    - NO cartoon exaggeration, caricature, or hand-drawn textures.
    - NO watercolor, gouache, or sketch aesthetic.

    SUBJECT / SCENE: ${step.prompt}.
    ${maybeNoText}
    Render PURE BACKGROUND ARTWORK ONLY.`;
      } else if (step.coverPart === "title") {
        // Title typography layer: text allowed
        finalPromptText = `
COMPOSITION: Thematic Story Title Typography.
SUBJECT TEXT: "${cleanTitle}" in a massive, stylized font.
THEMATIC STYLE: Typography material/style MUST be "${styleDescription}".
TEXTURE & MATERIAL: Detailed ${styleDescription} textures, 3D lighting, thematic glows.
BACKGROUND: ABSOLUTE PURE SOLID BLACK (#000000).
STRICT: NO ARTWORK, NO SCENERY, NO BORDERS. ONLY TYPOGRAPHY ON BLACK.`;
      } else if (step.coverPart === "cast") {
        // Cast typography layer: text allowed
        finalPromptText = `
COMPOSITION: Thematic Credit Typography.
SUBJECT TEXT: "Starring: ${cleanCast}".
THEMATIC STYLE: Font/material must match "${styleDescription}".
BACKGROUND: ABSOLUTE PURE SOLID BLACK (#000000).
STRICT: NO ARTWORK, NO SCENERY, NO BORDERS. ONLY THE STYLIZED TEXT ON BLACK.`;
      } else {
        // Fallback cover image (artwork): NO TEXT
        finalPromptText = `
${ruleContext}
${compositionContext}
COVER ARTWORK SCENE: ${step.prompt}.
${maybeNoText}
Pure full-bleed cinematic artwork.`;
      }
    }

    // ---------------- TITLE PAGE ----------------
    else if (step.type === "title") {
      // Title page is typography-only: text allowed
      if (step.prompt && step.prompt.trim()) {
        finalPromptText = `
${ruleContext}
COMPOSITION: Book Title Page.
${step.prompt.trim()}
BACKGROUND: ABSOLUTE PURE SOLID BLACK (#000000).
STRICT: NO SCENERY, NO BORDERS. ONLY TYPOGRAPHY ON BLACK.`;
      } else {
        finalPromptText = `
COMPOSITION: Book Title Page.
SUBJECT TEXT: "${cleanTitle}" in massive, epic stylized typography.
THEMATIC STYLE: Highly stylized cinematic title design matching "${styleDescription}".
BACKGROUND: ABSOLUTE PURE SOLID BLACK (#000000).
STRICT: NO SCENERY, NO BORDERS. ONLY THE STYLIZED TITLE ON BLACK.`;
      }
    }

    // ---------------- LAST PAGE (ENDING CARD) ----------------
    else if (step.type === "last") {
      // Ending card is typography-only: text allowed
      finalPromptText = `
COMPOSITION: Ending Card.
SUBJECT TEXT: "PABAIGA" in stylized cinematic typography matching "${styleDescription}".
BACKGROUND: ABSOLUTE PURE SOLID BLACK (#000000).
STRICT: NO ARTWORK, NO BORDERS. ONLY TEXT ON BLACK.`;
    }

    // ---------------- SCENE SPREADS ----------------
    else {
      // SCENE artwork must never include text, even if textSide is left/right.
      const legibilityHint = getLegibilityHint(step.textSide);

      finalPromptText = `
${ruleContext}
${compositionContext}
${legibilityHint}
SCENE: ${step.prompt}.
${maybeNoText}
Pure full-bleed cinematic artwork.`;
    }

    // ---------- Reference/context injection ----------
    let enhancedPrompt = finalPromptText;

    // Regeneration: use reference image, but keep NO_TEXT on non-typography layers
    if (referenceImageBase64 && !isTypographyLayer) {
      enhancedPrompt = `EDIT MODE:
- Use the reference image as a strong composition + character + environment anchor.
- Apply the requested changes, but keep style consistent.
- Do not introduce any text elements.

${enhancedPrompt}`;
    }

    if (characterRefBase64 && !isTypographyLayer) {
      enhancedPrompt = `PROTAGONIST & COMPANION REFERENCE:
Use the provided reference photo as an EXACT blueprint for the hero's appearance/outfit, hair, facial features, and ALL animals/pets visible in the reference.
Lock in IDENTICAL breed, color, markings, size, and anatomy for all animals shown—do NOT substitute, change color, or alter the animal in any way.
Preserve all identity-defining details (hair style, clothing, silhouette, animal type/breed/coloring).
Do not add any text elements.

${enhancedPrompt}`;
    }

    if (
      previousImageBase64 &&
      !isTypographyLayer &&
      step.type !== "cover" &&
      !referenceImageBase64
    ) {
      enhancedPrompt = `VISUAL CONTINUITY:
Match the artistic style, color grade, lighting mood, and rendering medium of the previous frame.
Do not introduce any text elements.

${enhancedPrompt}`;
    }

    // ---------- Call server ----------
    try {
      const response = await apiFetch(`${getApiBaseUrl()}/generate-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: enhancedPrompt,
          aspectRatio: config.aspectRatio,
          imageSize: config.imageSize,
          previousImageBase64:
            previousImageBase64 &&
            !isTypographyLayer &&
            step.type !== "cover" &&
            !referenceImageBase64
              ? previousImageBase64
              : undefined,
          characterRefBase64: characterRefBase64 && !isTypographyLayer ? characterRefBase64 : undefined,
          referenceImageBase64: referenceImageBase64 && !isTypographyLayer ? referenceImageBase64 : undefined,
        }),
      });

      const text = await response.text();
      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}`;
        try {
          const json = JSON.parse(text);
          if (json?.error) errorMessage = json.error;
        } catch {
          if (text) errorMessage = text.slice(0, 200);
        }
        throw new Error(errorMessage);
      }

      let data: { image?: string };
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("Invalid response from generate-image");
      }

      const image = data.image;
      if (!image) throw new Error("No image in response");

      return image;
    } catch (error: unknown) {
      console.error("Gemini Error:", error);
      throw error;
    }
  }
}
