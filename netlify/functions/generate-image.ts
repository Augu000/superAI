import type { Handler } from "@netlify/functions";

const IMAGE_MODEL = "gemini-3-pro-image-preview";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: "API_KEY not set" };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const {
    prompt,
    aspectRatio = "16:9",
    imageSize = "1K",
    previousImageBase64,
    characterRefBase64,
    referenceImageBase64,
    animalRefBase64,
  } = body;

  if (!prompt) {
    return { statusCode: 400, body: "Prompt required" };
  }

  const parts: any[] = [];

  // CRITICAL: Animal reference MUST be first for highest priority
  if (animalRefBase64) {
    parts.push({
      inline_data: {
        data: animalRefBase64.split(",")[1],
        mime_type: "image/png",
      },
    });
  }

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
    const res = await fetch(
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

    if (!res.ok) {
      const err = await res.text();
      return { statusCode: 500, body: err };
    }

    const data = await res.json();

    for (const part of data.candidates?.[0]?.content?.parts || []) {
      const img = part.inlineData?.data ?? part.inline_data?.data;
      if (img) {
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image: `data:image/png;base64,${img}`,
          }),
        };
      }
    }

    return { statusCode: 500, body: "No image returned" };
  } catch (e: any) {
    return { statusCode: 500, body: e.message || "Generation failed" };
  }
};
