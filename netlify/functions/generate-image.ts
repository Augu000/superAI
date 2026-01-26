import { Handler } from "@netlify/functions";
import { GoogleGenAI } from "@google/genai";

const IMAGE_MODEL = "gemini-3-pro-image-preview";

export const handler: Handler = async (event, context) => {
  // Handle CORS
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      } as Record<string, string>,
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: {
        "Access-Control-Allow-Origin": "*",
      } as Record<string, string>,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: {
          "Access-Control-Allow-Origin": "*",
        } as Record<string, string>,
        body: JSON.stringify({ error: "API_KEY environment variable is not set" }),
      };
    }

    const {
      prompt,
      aspectRatio,
      imageSize,
      previousImageBase64,
      characterRefBase64,
    } = JSON.parse(event.body || "{}");

    if (!prompt) {
      return {
        statusCode: 400,
        headers: {
          "Access-Control-Allow-Origin": "*",
        } as Record<string, string>,
        body: JSON.stringify({ error: "Prompt is required" }),
      };
    }

    const ai = new GoogleGenAI({ apiKey });
    const parts: any[] = [];

    // Add character reference if provided
    if (characterRefBase64) {
      const charData = characterRefBase64.replace(/^data:image\/(png|jpeg|webp);base64,/, "");
      parts.push({ inlineData: { data: charData, mimeType: "image/png" } });
      parts.push({ text: "PROTAGONIST REFERENCE: This is the hero character appearance." });
    }

    // Add previous image for continuity if provided
    if (previousImageBase64) {
      const prevData = previousImageBase64.replace(/^data:image\/(png|jpeg|webp);base64,/, "");
      parts.push({ inlineData: { data: prevData, mimeType: "image/png" } });
      parts.push({ text: "VISUAL CONTINUITY: Match the artistic style, color grade, and medium of this frame." });
    }

    parts.push({ text: prompt });

    const response = await ai.models.generateContent({
      model: IMAGE_MODEL,
      contents: { parts },
      config: {
        imageConfig: {
          aspectRatio: aspectRatio || "16:9",
          imageSize: imageSize || "1K",
        },
      },
    });

    if (!response.candidates?.[0]?.content?.parts) {
      throw new Error("Generation failed.");
    }

    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        return {
          statusCode: 200,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json",
          } as Record<string, string>,
          body: JSON.stringify({ image: `data:image/png;base64,${part.inlineData.data}` }),
        };
      }
    }

    throw new Error("No image data found.");
  } catch (error: any) {
    console.error("Error generating image:", error);
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
      } as Record<string, string>,
      body: JSON.stringify({ error: error.message || "Internal server error" }),
    };
  }
};
