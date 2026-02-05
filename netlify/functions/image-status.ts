import type { Handler } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const jobId = event.queryStringParameters?.jobId;

  if (!jobId) {
    return { statusCode: 400, body: "jobId query parameter required" };
  }

  try {
    const store = getStore("image-jobs");
    const job = await store.getJSON(jobId);

    if (!job) {
      return { statusCode: 404, body: "Job not found" };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(job),
    };
  } catch (e: any) {
    return { statusCode: 500, body: e.message || "Failed to retrieve job status" };
  }
};
