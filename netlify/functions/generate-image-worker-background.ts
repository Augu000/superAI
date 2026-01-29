import type { Handler } from "@netlify/functions";
import { connectLambda, getStore } from "@netlify/blobs";
import { GoogleGenAI } from "@google/genai";

const IMAGE_MODEL = "gemini-3-pro-image-preview";
const STORE_NAME = "image-generation-jobs";

async function runGeminiImageGeneration(request: {
  prompt: string;
  aspectRatio?: string;
  imageSize?: string;
  previousImageBase64?: string;
  characterRefBase64?: string;
  referenceImageBase64?: string;
}, apiKey: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey });
  const parts: { inlineData?: { data: string; mimeType: string }; text?: string }[] = [];

  const { prompt, aspectRatio, imageSize, previousImageBase64, characterRefBase64, referenceImageBase64 } = request;

  if (referenceImageBase64) {
    const refData = referenceImageBase64.replace(/^data:image\/(png|jpeg|webp);base64,/, "");
    parts.push({ inlineData: { data: refData, mimeType: "image/png" } });
  }
  if (characterRefBase64) {
    const charData = characterRefBase64.replace(/^data:image\/(png|jpeg|webp);base64,/, "");
    parts.push({ inlineData: { data: charData, mimeType: "image/png" } });
    parts.push({ text: "PROTAGONIST REFERENCE: This is the hero character appearance." });
  }
  if (previousImageBase64 && !referenceImageBase64) {
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
      return `data:image/png;base64,${part.inlineData.data}`;
    }
  }
  throw new Error("No image data found.");
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "" };

  let jobId: string;
  try {
    const body = JSON.parse(event.body || "{}");
    jobId = body.jobId;
    if (!jobId) throw new Error("jobId required");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid body or missing jobId" }) };
  }

  connectLambda(event);

  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    const store = getStore({ name: STORE_NAME, consistency: "eventual" });
    await store.set(jobId, JSON.stringify({ status: "error", error: "API_KEY not set" }));
    return { statusCode: 200, body: "" };
  }

  const store = getStore({ name: STORE_NAME, consistency: "eventual" });
  const raw = await store.get(jobId);
  if (raw === null) {
    return { statusCode: 404, body: JSON.stringify({ error: "Job not found" }) };
  }

  const job = JSON.parse(raw as string);
  if (job.status !== "pending" || !job.request) {
    return { statusCode: 400, body: JSON.stringify({ error: "Job not pending or missing request" }) };
  }

  try {
    const image = await runGeminiImageGeneration(job.request, apiKey);
    await store.set(jobId, JSON.stringify({ status: "completed", image }));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Image generation failed";
    console.error("generate-image-worker error:", err);
    await store.set(jobId, JSON.stringify({ status: "error", error: message }));
  }

  return { statusCode: 200, body: "" };
};
