import { Handler } from "@netlify/functions";

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
    const promptText = `Analyze these narrative scenes and determine a catchy cinematic title and a specific visual style for the typography that matches the theme (e.g., "weathered pirate wood", "neon high-tech pulse", "medieval forged iron", "elegant victorian gold").\n\nNarrative Context:\n${combined}\n\nRespond with valid JSON: {"title": "...", "visualStyle": "..."}`;

    const directRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    });
    if (!directRes.ok) {
      const errBody = await directRes.text();
      throw new Error(errBody || `HTTP ${directRes.status}`);
    }
    const directData = await directRes.json();
    const rawText = directData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";

    try {
      const data = JSON.parse(rawText || "{}");
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
