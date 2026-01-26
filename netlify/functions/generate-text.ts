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
    console.log("generate-text function called");
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      console.error("API_KEY not set");
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
      console.error("Prompt missing");
      return {
        statusCode: 400,
        headers: {
          "Access-Control-Allow-Origin": "*",
        } as Record<string, string>,
        body: JSON.stringify({ error: "Prompt is required" }),
      };
    }

    console.log("Calling Gemini API with model:", TEXT_MODEL);
    console.log("Prompt length:", prompt.length);
    
    const ai = new GoogleGenAI({ apiKey });
    const startTime = Date.now();
    console.log("Making API call...");
    const response = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    const duration = Date.now() - startTime;
    console.log(`API call completed in ${duration}ms`);
    console.log("Response type:", typeof response);
    console.log("Response keys:", Object.keys(response || {}));

    // Extract text from response - try multiple formats
    let text = "";
    if ((response as any)?.text) {
      text = String((response as any).text);
      console.log("Got text from response.text");
    } else if ((response as any)?.response?.text) {
      const textMethod = (response as any).response.text;
      text = typeof textMethod === "function" ? String(textMethod()) : String(textMethod);
      console.log("Got text from response.response.text()");
    } else if ((response as any)?.candidates?.[0]?.content?.parts?.[0]?.text) {
      text = String((response as any).candidates[0].content.parts[0].text);
      console.log("Got text from response.candidates[0].content.parts[0].text");
    } else {
      console.error("Could not extract text from response:", JSON.stringify(response, null, 2));
      throw new Error("Could not extract text from API response");
    }
    
    console.log("Extracted text length:", text.length);

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
