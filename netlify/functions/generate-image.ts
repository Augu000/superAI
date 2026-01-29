import { Handler } from "@netlify/functions";
import { connectLambda, getStore } from "@netlify/blobs";
import { v4 as uuidv4 } from "uuid";

const STORE_NAME = "image-generation-jobs";
const CORS = { "Access-Control-Allow-Origin": "*" } as Record<string, string>;

function getBaseUrl(event: { headers?: Record<string, string> }): string {
  const url = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (url) return url.replace(/\/$/, "");
  const host = event.headers?.["x-forwarded-host"] || event.headers?.host;
  const proto = event.headers?.["x-forwarded-proto"] || "http";
  if (host) return `${proto}://${host}`;
  return "http://localhost:8888";
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        ...CORS,
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: CORS,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "API_KEY environment variable is not set" }),
    };
  }

  let prompt: string;
  let aspectRatio: string | undefined;
  let imageSize: string | undefined;
  let previousImageBase64: string | undefined;
  let characterRefBase64: string | undefined;
  let referenceImageBase64: string | undefined;

  try {
    const body = JSON.parse(event.body || "{}");
    prompt = body.prompt;
    aspectRatio = body.aspectRatio;
    imageSize = body.imageSize;
    previousImageBase64 = body.previousImageBase64;
    characterRefBase64 = body.characterRefBase64;
    referenceImageBase64 = body.referenceImageBase64;
  } catch {
    return {
      statusCode: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Invalid JSON body" }),
    };
  }

  if (!prompt || typeof prompt !== "string") {
    return {
      statusCode: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Prompt is required" }),
    };
  }

  const jobId = uuidv4();
  const request = {
    prompt,
    aspectRatio,
    imageSize,
    previousImageBase64,
    characterRefBase64,
    referenceImageBase64,
  };

  try {
    connectLambda(event);
    const store = getStore({ name: STORE_NAME, consistency: "eventual" });
    await store.set(jobId, JSON.stringify({ status: "pending", request }));

    const baseUrl = getBaseUrl(event);
    const workerUrl = `${baseUrl}/.netlify/functions/generate-image-worker-background`;
    await fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    });

    return {
      statusCode: 202,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to enqueue job";
    return {
      statusCode: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: message }),
    };
  }
};
