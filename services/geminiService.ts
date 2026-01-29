// src/services/geminiService.ts
import type { AspectRatio, ImageSize } from "../types";

type StepType = "cover" | "first" | "middle" | "last" | "title";
type TextSide = "left" | "right" | "none";
type CoverPart = "background" | "title" | "cast";

// Use relative path so app and functions are same-origin (no CORS).
// Run "npm run dev:netlify" and open http://localhost:8888 (not :3000).
const getApiBaseUrl = () => "/.netlify/functions";

const NETLIFY_DEV_MSG =
  "Cannot reach the API. Run: npm run dev:netlify — then open http://localhost:8888 (do not use port 3000).";

async function apiFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e: any) {
    const msg = e?.message || String(e);
    if (msg.includes("Failed to fetch") || msg.includes("ERR_CONNECTION_REFUSED") || msg.includes("Load failed")) {
      throw new Error(NETLIFY_DEV_MSG);
    }
    throw e;
  }
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
      headers: {
        "Content-Type": "application/json",
      },
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
      headers: {
        "Content-Type": "application/json",
      },
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
    const combined = prompts.filter((p: string) => p.trim().length > 0).join("\n");
    const response = await apiFetch(`${getApiBaseUrl()}/generate-text`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: `Based on this story context, generate ONE character name (the hero/main character name) in 1-2 words maximum. Just return the name, nothing else.\n\nStory Context:\n${combined}`,
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
    referenceImageBase64?: string // For regeneration - maintains same composition with edits
  ): Promise<string> {
    const ruleContext =
      globalRules.length > 0 ? `Visual Style Requirements: ${globalRules.join(", ")}. ` : "";

    let compositionContext = `COMPOSITION: ${config.aspectRatio} aspect ratio. `;

    const cleanTitle = (step.bookTitle || "UNTITLED").replace(/[*#_>`]/g, "").trim();
    const cleanCast = (step.cast || "THE HERO").replace(/[*#_>`]/g, "").trim();
    const styleDescription = step.storyStyle || "cinematic and epic";

    // PROHIBIT ALL TECHNICAL LINES & ARTIFACTS
    compositionContext += `IMAGE QUALITY:
1. NO TECHNICAL MARKS: Do not render any borders, crop marks, safe zones, margins, bleed lines, or bending lines.
2. EDGE-TO-EDGE: The artwork must be a pure, continuous image reaching all four corners. `;

    // Demographic exclusion
    if (config.demographicExclusion) {
      compositionContext += `CHARACTER DEMOGRAPHICS: Do not include any characters with dark skin tones or Black people in this image. `;
    }

    let finalPromptText = "";

    if (step.type === "cover") {
      if (step.coverPart === "background") {
        compositionContext += `LAYOUT: SEAMLESS WRAP-AROUND book cover background.
ABSOLUTE PROHIBITION: DO NOT render any vertical lines, splitters, center dividers, spine creases, or bending marks. The image MUST be a single, continuous, uninterrupted landscape.
FRONT COVER (RIGHT HALF): Position characters and main focal points in the BOTTOM-RIGHT area only.
EXTREME NEGATIVE SPACE: The TOP 70% of the entire right side must be EMPTY and clear (only sky, atmosphere, or subtle environmental texture) to allow for manual title placement.
SUBJECT: ${step.prompt}.`;

        finalPromptText = `${ruleContext} ${compositionContext} Render the PURE BACKGROUND ARTWORK ONLY. No text, no lines, no dividers.`;
      } else if (step.coverPart === "title") {
        compositionContext = `COMPOSITION: Thematic Story Title Typography.
SUBJECT: "${cleanTitle}" in a massive, stylized font.
THEMATIC STYLE: The typography style MUST be "${styleDescription}".
TEXTURE & MATERIAL: Use detailed ${styleDescription} textures, 3D lighting, and thematic glows.
STRICTLY AVOID generic styles; it must look like it belongs to the world of "${cleanTitle}".
BACKGROUND: ABSOLUTE PURE SOLID BLACK (#000000).
STRICT: NO ARTWORK, NO SCENERY, NO LINES. ONLY THE THEMATIC STYLIZED TYPOGRAPHY ON BLACK.`;
        finalPromptText = compositionContext;
      } else if (step.coverPart === "cast") {
        compositionContext = `COMPOSITION: Thematic Credit Typography.
SUBJECT: "Starring: ${cleanCast}".
THEMATIC STYLE: Font and material must match the "${styleDescription}" theme.
BACKGROUND: ABSOLUTE PURE SOLID BLACK (#000000).
STRICT: NO ARTWORK, NO SCENERY, NO BORDERS. ONLY THE STYLIZED TEXT ON BLACK.`;
        finalPromptText = compositionContext;
      } else {
        // fallback (if coverPart missing)
        finalPromptText = `${ruleContext} ${compositionContext} COVER: ${step.prompt}. Pure full-bleed cinematic artwork with no borders.`;
      }
    } else if (step.type === "title") {
      // Book Title Page: use 3D Logo Prompt from Book Generator when transferred, else fallback
      if (step.prompt && step.prompt.trim()) {
        finalPromptText = `${ruleContext}COMPOSITION: Book Title Page. ${step.prompt.trim()} BACKGROUND: ABSOLUTE PURE SOLID BLACK (#000000). STRICT: NO SCENERY, NO BORDERS. ONLY TYPOGRAPHY ON BLACK.`;
      } else {
        compositionContext = `COMPOSITION: Book Title Page.
SUBJECT: "${cleanTitle}" in massive, epic stylized typography.
THEMATIC STYLE: Use highly stylized cinematic title design matching: "${styleDescription}". Text should be richly textured, 3D, and visually stunning.
BACKGROUND: ABSOLUTE PURE SOLID BLACK (#000000).
STRICT: NO SCENERY, NO BORDERS. ONLY THE STYLIZED TITLE ON BLACK.`;
        finalPromptText = compositionContext;
      }
    } else if (step.type === "last") {
      compositionContext = `COMPOSITION: Ending Card.
SUBJECT: "PABAIGA" in stylized cinematic typography matching: "${styleDescription}".
BACKGROUND: ABSOLUTE PURE SOLID BLACK (#000000).
STRICT: NO ARTWORK, NO BORDERS. ONLY TEXT ON BLACK.`;
      finalPromptText = compositionContext;
    } else {
      const shadowSide = step.textSide === "left" ? "LEFT" : "RIGHT";
      if (step.textSide !== "none") {
        compositionContext += `LIGHTING: Soft cinematic vignetting on the ${shadowSide} side for text legibility. `;
      }
      finalPromptText = `${ruleContext} ${compositionContext} SCENE: ${step.prompt}. Pure full-bleed cinematic artwork with no borders.`;
    }

    const isTypographyLayer =
      step.type === "last" ||
      step.type === "title" ||
      step.coverPart === "title" ||
      step.coverPart === "cast";

    // Add image context to prompt if we have reference images
    let enhancedPrompt = finalPromptText;
    
    // If regenerating with reference image, maintain composition but apply edits
    if (referenceImageBase64 && !isTypographyLayer) {
      enhancedPrompt = `REGENERATION MODE: This is the original image. Maintain the exact same composition, camera angle, layout, and overall structure. Apply ONLY the requested changes while keeping everything else identical.\n\n${enhancedPrompt}`;
    }
    
    if (characterRefBase64 && !isTypographyLayer) {
      enhancedPrompt = `PROTAGONIST REFERENCE: This is the hero character appearance.\n${enhancedPrompt}`;
    }
    if (previousImageBase64 && !isTypographyLayer && step.type !== "cover" && !referenceImageBase64) {
      // Only use previousImage for continuity if not regenerating (regeneration uses referenceImage instead)
      enhancedPrompt = `VISUAL CONTINUITY: Match the artistic style, color grade, and medium of this frame.\n${enhancedPrompt}`;
    }

    try {
      const response = await apiFetch(`${getApiBaseUrl()}/generate-image`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: enhancedPrompt,
          aspectRatio: config.aspectRatio,
          imageSize: config.imageSize,
          previousImageBase64: previousImageBase64 && !isTypographyLayer && step.type !== "cover" && !referenceImageBase64 ? previousImageBase64 : undefined,
          characterRefBase64: characterRefBase64 && !isTypographyLayer ? characterRefBase64 : undefined,
          referenceImageBase64: referenceImageBase64 && !isTypographyLayer ? referenceImageBase64 : undefined,
        }),
      });

      const text = await response.text();
      if (response.status !== 202) {
        let errorMessage = `HTTP ${response.status}`;
        try {
          const json = JSON.parse(text);
          if (json?.error) errorMessage = json.error;
        } catch {
          if (text) errorMessage = text.slice(0, 200);
        }
        throw new Error(errorMessage);
      }

      let data: { jobId?: string };
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("Invalid response from generate-image");
      }
      const jobId = data.jobId;
      if (!jobId) {
        throw new Error("No jobId in response");
      }

      const pollIntervalMs = 2000;
      const maxWaitMs = 5 * 60 * 1000;
      const started = Date.now();

      for (;;) {
        const statusRes = await apiFetch(
          `${getApiBaseUrl()}/image-status?jobId=${encodeURIComponent(jobId)}`,
          { method: "GET" }
        );
        const statusText = await statusRes.text();
        if (!statusRes.ok) {
          throw new Error(statusRes.status === 404 ? "Job not found" : statusText || `HTTP ${statusRes.status}`);
        }
        const statusData = JSON.parse(statusText) as { status: string; image?: string; error?: string };
        if (statusData.status === "completed") {
          if (statusData.image) return statusData.image;
          throw new Error("No image data found.");
        }
        if (statusData.status === "error") {
          throw new Error(statusData.error || "Image generation failed");
        }
        if (Date.now() - started >= maxWaitMs) {
          throw new Error("Image generation timed out");
        }
        await new Promise((r) => setTimeout(r, pollIntervalMs));
      }
    } catch (error: unknown) {
      console.error("Gemini Error:", error);
      throw error;
    }
  }
}
