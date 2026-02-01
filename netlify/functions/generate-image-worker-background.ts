import type { Handler } from "@netlify/functions";
import { connectLambda, getStore } from "@netlify/blobs";

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
  const parts: { inline_data?: { data: string; mime_type: string }; text?: string }[] = [];
  const { prompt, aspectRatio, imageSize, previousImageBase64, characterRefBase64, referenceImageBase64 } = request;

  if (referenceImageBase64) {
    const refData = referenceImageBase64.replace(/^data:image\/(png|jpeg|webp);base64,/, "");
    parts.push({ inline_data: { data: refData, mime_type: "image/png" } });
  }
  if (characterRefBase64) {
    const charData = characterRefBase64.replace(/^data:image\/(png|jpeg|webp);base64,/, "");
    parts.push({ inline_data: { data: charData, mime_type: "image/png" } });
    parts.push({ text: "PROTAGONIST REFERENCE: This is the hero character appearance." });
  }
  if (previousImageBase64 && !referenceImageBase64) {
    const prevData = previousImageBase64.replace(/^data:image\/(png|jpeg|webp);base64,/, "");
    parts.push({ inline_data: { data: prevData, mime_type: "image/png" } });
    parts.push({ text: "VISUAL CONTINUITY: Match the artistic style, color grade, and medium of this frame." });
  }
  parts.push({ text: prompt });

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: aspectRatio || "16:9", imageSize: imageSize || "1K" },
      },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!data.candidates?.[0]?.content?.parts) throw new Error("Generation failed.");
  for (const part of data.candidates[0].content.parts) {
    const imgData = part.inlineData?.data ?? part.inline_data?.data;
    if (imgData) return `data:image/png;base64,${imgData}`;
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

  connectLambda(event as any);

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

  const job = JSON.parse(raw as unknown as string);
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
