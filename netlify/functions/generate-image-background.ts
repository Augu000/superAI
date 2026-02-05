import type { Handler } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

const IMAGE_MODEL = "gemini-3-pro-image-preview";

export const handler: Handler = async (event) => {
  const { jobId, payload } = JSON.parse(event.body || "{}");

  if (!jobId || !payload) {
    return { statusCode: 400, body: "Missing jobId or payload" };
  }

  // Update status to processing
  await updateJobStatus(jobId, "processing");

  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    await updateJobStatus(jobId, "error", { error: "API_KEY not set" });
    return { statusCode: 500, body: "API_KEY not set" };
  }

  const {
    prompt,
    aspectRatio = "16:9",
    imageSize = "1K",
    previousImageBase64,
    characterRefBase64,
    referenceImageBase64,
  } = payload;

  try {
    const parts: any[] = [];

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
      await updateJobStatus(jobId, "error", { error: err });
      return { statusCode: 500, body: err };
    }

    const data = await res.json();

    for (const part of data.candidates?.[0]?.content?.parts || []) {
      const img = part.inlineData?.data ?? part.inline_data?.data;
      if (img) {
        await updateJobStatus(jobId, "completed", {
          image: `data:image/png;base64,${img}`,
        });
        return { statusCode: 200, body: "Image generated successfully" };
      }
    }

    await updateJobStatus(jobId, "error", { error: "No image returned" });
    return { statusCode: 500, body: "No image returned" };
  } catch (e: any) {
    await updateJobStatus(jobId, "error", { error: e.message || "Generation failed" });
    return { statusCode: 500, body: e.message || "Generation failed" };
  }
};

async function updateJobStatus(
  jobId: string,
  status: string,
  data?: any
): Promise<void> {
  try {
    const store = getStore("image-jobs");
    await store.setJSON(jobId, {
      status,
      ...data,
      timestamp: Date.now(),
    });
  } catch (e) {
    console.error("Failed to update job status:", e);
  }
}
