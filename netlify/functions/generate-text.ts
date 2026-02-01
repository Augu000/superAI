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
    console.log("generate-text function called");
    const apiKey = process.env.API_KEY;
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/c834aa7f-5a21-4ef4-aa2d-4f530770aaf0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'generate-text.ts:entry',message:'API_KEY diagnostics',data:{hasApiKey:!!apiKey,length:apiKey?.length??0,startsWithAIza:apiKey?.startsWith?.('AIza')??false,first7:apiKey?.slice?.(0,7)??null,last4:apiKey?.length?apiKey.slice(-4):null,hasGEMINI_API_KEY:!!process.env.GEMINI_API_KEY,envKeysWithAPI:Object.keys(process.env||{}).filter((k)=>k.includes('API')||k.includes('GEMINI'))},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A,C,D,E'})}).catch(()=>{});
    // #endregion
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

    // #region agent log - direct fetch diagnostic (hypothesis B): use same request as curl
    const directRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt}]}]})});
    fetch('http://127.0.0.1:7243/ingest/c834aa7f-5a21-4ef4-aa2d-4f530770aaf0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'generate-text.ts:directFetch',message:'Direct fetch to Gemini API',data:{status:directRes.status,ok:directRes.ok},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'B'})}).catch(()=>{});
    if (directRes.ok) {
      const directData = await directRes.json();
      const text = directData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      fetch('http://127.0.0.1:7243/ingest/c834aa7f-5a21-4ef4-aa2d-4f530770aaf0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'generate-text.ts:directFetchSuccess',message:'Direct fetch succeeded, bypassing SDK',data:{textLen:text.length},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'B'})}).catch(()=>{});
      return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" } as Record<string, string>, body: JSON.stringify({ text: String(text || "") }) };
    }
    const errBody = await directRes.text();
    fetch('http://127.0.0.1:7243/ingest/c834aa7f-5a21-4ef4-aa2d-4f530770aaf0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'generate-text.ts:directFetchFail',message:'Direct fetch failed',data:{status:directRes.status,errBodySlice:errBody.slice(0,200)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A,C,D'})}).catch(()=>{});
    throw new Error(errBody || `HTTP ${directRes.status}`);
    // #endregion
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
