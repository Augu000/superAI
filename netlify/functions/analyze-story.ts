import { Handler } from "@netlify/functions";
import { GoogleGenAI, Type } from "@google/genai";

const TEXT_MODEL = "gemini-3-flash-preview";

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

    const { prompts } = JSON.parse(event.body || "{}");
    if (!prompts || !Array.isArray(prompts)) {
      return {
        statusCode: 400,
        headers: {
          "Access-Control-Allow-Origin": "*",
        } as Record<string, string>,
        body: JSON.stringify({ error: "Prompts array is required" }),
      };
    }

    const combined = prompts.filter((p: string) => p.trim().length > 0).join("\n");

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
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
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        } as Record<string, string>,
        body: JSON.stringify({
          title: data.title || "A Nano Tale",
          visualStyle: data.visualStyle || "cinematic gold and light",
        }),
      };
    } catch {
      return {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        } as Record<string, string>,
        body: JSON.stringify({
          title: "A Nano Tale",
          visualStyle: "cinematic gold and light",
        }),
      };
    }
  } catch (error: any) {
    console.error("Error analyzing story:", error);
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
      } as Record<string, string>,
      body: JSON.stringify({ error: error.message || "Internal server error" }),
    };
  }
};
