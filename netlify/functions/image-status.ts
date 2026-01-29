import { Handler } from "@netlify/functions";
import { connectLambda, getStore } from "@netlify/blobs";

const STORE_NAME = "image-generation-jobs";
const CORS = { "Access-Control-Allow-Origin": "*" } as Record<string, string>;

export const handler: Handler = async (event) => {
  connectLambda(event as any);

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        ...CORS,
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: CORS,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  const jobId = event.queryStringParameters?.jobId;
  if (!jobId) {
    return {
      statusCode: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "jobId is required" }),
    };
  }

  try {
    const store = getStore({ name: STORE_NAME, consistency: "eventual" });
    const raw = await store.get(jobId);
    if (raw === null) {
      return {
        statusCode: 404,
        headers: { ...CORS, "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Job not found" }),
      };
    }

    const job = JSON.parse(raw as unknown as string);
    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({
        status: job.status,
        image: job.image ?? undefined,
        error: job.error ?? undefined,
      }),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return {
      statusCode: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: message }),
    };
  }
};
