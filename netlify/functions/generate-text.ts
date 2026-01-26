import { Handler } from "@netlify/functions";
import { GoogleGenAI } from "@google/genai";

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

    const { prompt } = JSON.parse(event.body || "{}");
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
    const response = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    // SDK sometimes exposes `.text`, sometimes `.response.text()`.
    const text =
      (response as any)?.text ??
      (response as any)?.response?.text?.() ??
      "";

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      } as Record<string, string>,
      body: JSON.stringify({ text: String(text || "") }),
    };
  } catch (error: any) {
    console.error("Error generating text:", error);
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
      } as Record<string, string>,
      body: JSON.stringify({ error: error.message || "Internal server error" }),
    };
  }
};
