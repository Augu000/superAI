// src/services/geminiService.ts
import { GoogleGenAI, Type } from "@google/genai";
import type { AspectRatio, ImageSize } from "../types";

const IMAGE_MODEL = "gemini-3-pro-image-preview";
const TEXT_MODEL = "gemini-3-flash-preview";

type StepType = "cover" | "first" | "middle" | "last";
type TextSide = "left" | "right" | "none";
type CoverPart = "background" | "title" | "cast";

export class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    const apiKey = import.meta.env.VITE_API_KEY;
    if (!apiKey) {
      throw new Error('VITE_API_KEY environment variable is not set');
    }
    this.ai = new GoogleGenAI({ apiKey });
  }

  /**
   * NEW: generic text generation helper for the BookTextService.
   * Returns plain text.
   */
  async generateText(prompt: string): Promise<string> {
    const res = await this.ai.models.generateContent({
      model: TEXT_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    // SDK sometimes exposes `.text`, sometimes `.response.text()`.
    const text =
      (res as any)?.text ??
      (res as any)?.response?.text?.() ??
      "";

    return String(text || "");
  }

  async analyzeStory(prompts: string[]): Promise<{ title: string; visualStyle: string }> {
    const combined = prompts.filter((p) => p.trim().length > 0).join("\n");

    const response = await this.ai.models.generateContent({
      model: TEXT_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                `Analyze these narrative scenes and determine a catchy cinematic title and a specific visual style for the typography that matches the theme ` +
                `(e.g., "weathered pirate wood", "neon high-tech pulse", "medieval forged iron", "elegant victorian gold").\n\n` +
                `Narrative Context:\n${combined}`,
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: "Maximum 5 words." },
            visualStyle: { type: Type.STRING, description: "Description of the font's material, texture, and energy." },
          },
          required: ["title", "visualStyle"],
        },
      },
    });

    try {
      const data = JSON.parse(response.text || "{}");
      return {
        title: data.title || "A Nano Tale",
        visualStyle: data.visualStyle || "cinematic gold and light",
      };
    } catch {
      return { title: "A Nano Tale", visualStyle: "cinematic gold and light" };
    }
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
    characterRefBase64?: string
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

    // NOTE: demographicExclusion intentionally NOT supported.

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
    } else if (step.type === "first") {
      compositionContext = `COMPOSITION: Opening Story Logo.
SUBJECT: "${cleanTitle}".
THEMATIC STYLE: Use highly stylized cinematic logo design matching: "${styleDescription}". Text should be richly textured and colored.
BACKGROUND: ABSOLUTE PURE SOLID BLACK (#000000).
STRICT: NO SCENERY, NO BORDERS. ONLY THE STYLIZED LOGO ON BLACK.`;
      finalPromptText = compositionContext;
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

    const parts: any[] = [];

    const isTypographyLayer =
      step.type === "first" ||
      step.type === "last" ||
      step.coverPart === "title" ||
      step.coverPart === "cast";

    if (characterRefBase64 && !isTypographyLayer) {
      const charData = characterRefBase64.replace(/^data:image\/(png|jpeg|webp);base64,/, "");
      parts.push({ inlineData: { data: charData, mimeType: "image/png" } });
      parts.push({ text: "PROTAGONIST REFERENCE: This is the hero character appearance." });
    }

    if (previousImageBase64 && !isTypographyLayer && step.type !== "cover") {
      const prevData = previousImageBase64.replace(/^data:image\/(png|jpeg|webp);base64,/, "");
      parts.push({ inlineData: { data: prevData, mimeType: "image/png" } });
      parts.push({ text: "VISUAL CONTINUITY: Match the artistic style, color grade, and medium of this frame." });
    }

    parts.push({ text: finalPromptText });

    try {
      const response = await this.ai.models.generateContent({
        model: IMAGE_MODEL,
        contents: { parts },
        config: { imageConfig: { aspectRatio: config.aspectRatio, imageSize: config.imageSize } },
      });

      if (!response.candidates?.[0]?.content?.parts) throw new Error("Generation failed.");

      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
      }

      throw new Error("No image data found.");
    } catch (error: any) {
      console.error("Gemini Error:", error);
      throw error;
    }
  }
}
