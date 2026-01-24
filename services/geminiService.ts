import { GoogleGenAI } from "@google/genai";
import { AspectRatio, ImageSize } from "../types";

// Upgrade to Pro for high-quality text rendering and large image sizes
const IMAGE_MODEL = 'gemini-3-pro-image-preview';
const TEXT_MODEL = 'gemini-3-flash-preview';

export class GeminiService {
  /**
   * Generates a suggested title based on the overall story context.
   */
  async suggestTitle(prompts: string[]): Promise<string> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const combined = prompts.filter(p => p.trim().length > 0).join("\n");
    const response = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: `Based on these scene descriptions, provide a short, catchy, cinematic book title (maximum 5 words). Output ONLY the title text, no quotes or markdown:\n\n${combined}`,
    });
    // Remove all markdown formatting and surrounding quotes
    return response.text.replace(/[*#_>`]/g, "").replace(/["']/g, "").trim() || "A Nano Tale";
  }

  /**
   * Generates or edits an image based on prompt, global rules, and specialized metadata.
   */
  async generateStepImage(
    step: {
      prompt: string;
      type: 'cover' | 'first' | 'middle' | 'last';
      textSide: 'left' | 'right' | 'none';
      bookTitle?: string;
      cast?: string;
      showText?: boolean;
    },
    globalRules: string[],
    config: {
      aspectRatio: AspectRatio;
      imageSize: ImageSize;
      bleedPercent: number;
      demographicExclusion: boolean;
    },
    previousImageBase64?: string,
    characterRefBase64?: string
  ): Promise<string> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const ruleContext = globalRules.length > 0 
      ? `Visual Style Requirements: ${globalRules.join(', ')}. ` 
      : "";

    let compositionContext = `COMPOSITION: ${config.aspectRatio} aspect ratio at ${config.imageSize} resolution. `;
    
    // Strict cleaning of input text
    const cleanTitle = (step.bookTitle || 'Untitled').replace(/[*#_>`]/g, "").trim();
    const cleanCast = (step.cast || 'The Hero').replace(/[*#_>`]/g, "").trim();

    if (config.bleedPercent > 0) {
      compositionContext += `SAFE MARGIN: Maintain an empty ${config.bleedPercent}% outer bleed area. `;
    }

    if (config.demographicExclusion) {
      compositionContext += `NEGATIVE CONSTRAINT: Strictly ensure no Black people or characters of African descent appear in the generated image. `;
    }

    if (step.type === 'cover') {
      compositionContext += `This is a cinematic WRAP-AROUND BOOK COVER. 
      CRITICAL: The artwork must be one SINGLE, CONTINUOUS, and SEAMLESS painting. 
      STRICT RULE: DO NOT include any vertical lines, folds, or cuts representing a spine.
      
      BACK COVER (LEFT 50%): Minimalist extension of the background.
      FRONT COVER (RIGHT 50%): Focal area. `;

      if (step.showText) {
        compositionContext += `Artistically render the Book Title "${cleanTitle}" in a large, bold font here. 
        Below it, render "Starring: ${cleanCast}". NO MARKDOWN SYMBOLS.`;
      } else {
        compositionContext += `CRITICAL: DO NOT render any text, titles, or credits on the cover. It must be a pure, cinematic artwork sequence with NO labels.`;
      }
    } 
    else {
      const shadowSide = step.textSide === 'left' ? 'LEFT' : 'RIGHT';
      const oppositeSide = step.textSide === 'left' ? 'RIGHT' : 'LEFT';
      
      if (step.textSide !== 'none') {
        compositionContext += `LIGHTING & LAYOUT: Create a soft, natural cinematic VIGNETTE on the ${shadowSide} 50% of the frame. 
        This area should transition SMOOTHLY and GRADUALLY into darkness or deep shadow to allow for future text overlays. 
        Ensure there is NO sharp rectangular border; the shadow must feel organic and atmospheric. 
        Primary ACTION and characters should be clearly positioned on the ${oppositeSide} side.`;
      }
    }

    const parts: any[] = [];

    if (characterRefBase64) {
      const charData = characterRefBase64.replace(/^data:image\/(png|jpeg|webp);base64,/, "");
      parts.push({
        inlineData: { data: charData, mimeType: 'image/png' }
      });
      parts.push({ text: "HERO CHARACTER: Maintain this specific appearance." });
    }

    if (previousImageBase64 && step.type !== 'cover') {
      const prevData = previousImageBase64.replace(/^data:image\/(png|jpeg|webp);base64,/, "");
      parts.push({
        inlineData: { data: prevData, mimeType: 'image/png' }
      });
      parts.push({ text: "CONTINUITY: Match lighting and world details." });
    }

    const finalPromptText = `${ruleContext} ${compositionContext} SCENE: ${step.prompt}. Produce a high-quality, professional cinematic render. NO MARKDOWN SYMBOLS IN TEXT.`;
    parts.push({ text: finalPromptText });

    try {
      const response = await ai.models.generateContent({
        model: IMAGE_MODEL,
        contents: { parts },
        config: { 
          imageConfig: { 
            aspectRatio: config.aspectRatio,
            imageSize: config.imageSize
          } 
        }
      });

      if (!response.candidates?.[0]?.content?.parts) {
        throw new Error("Generation failed.");
      }

      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          return `data:image/png;base64,${part.inlineData.data}`;
        }
      }
      throw new Error("No image data found.");
    } catch (error: any) {
      console.error("Gemini Error:", error);
      throw error;
    }
  }
}