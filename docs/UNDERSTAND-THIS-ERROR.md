# Understand This Error

## 404 (Not Found)

**What it means:** The browser asked for a URL and the server said “nothing here.”

**Common causes here:**

- **Favicon / static asset** – The page requests something like `/favicon.ico` or a source map; if the app doesn’t serve it, you get 404. Usually safe to ignore unless something is broken.
- **Wrong URL** – A link or script points to a path that doesn’t exist (typo or old path).
- **Function path** – If the 404 is on `/.netlify/functions/...`, Netlify Dev might not be running or the function name doesn’t match (e.g. `generate-text` vs `generateText`). Use `npm run dev:netlify` and open **http://localhost:8888**.

**What to do:** Note the **exact URL** in the browser’s Network tab that returns 404. If it’s a function, ensure `npm run dev:netlify` is running and you’re on port 8888.

---

## 500 on `/.netlify/functions/generate-text`

**What it means:** The `generate-text` serverless function ran but threw an error or timed out, so Netlify returns 500.

**Common causes:**

| Cause | What you see | Fix |
|-------|----------------|-----|
| **API key missing** | `API_KEY environment variable is not set` (in response or terminal) | Add `API_KEY=your_google_ai_key` to a `.env` file in the project root. Get a key from [Google AI Studio](https://aistudio.google.com/app/apikey). |
| **Timeout** | `Task timed out after 30.00 seconds` (in terminal); Gemini can take 25–60s for long prompts | `netlify.toml` already sets `[functions.generate-text] timeout = 60`. If you still see 30s, restart `npm run dev:netlify` and ensure Netlify CLI is up to date. |
| **Gemini API error** | Message about quota, model not found, or invalid request | Check the **terminal** where `netlify dev` is running for the real error. Fix key, model name, or quota. |
| **Network / unreachable** | `Failed to fetch` or connection errors in the browser | Use **http://localhost:8888** (not 3000). Run `npm run dev:netlify` so both the app and functions are on the same origin. |

**What to do:**

1. Open the **terminal** where you ran `npm run dev:netlify` and look at the log line for the failing request (e.g. “API_KEY not set”, “Task timed out”, or a Gemini stack trace).
2. In the browser, open **Network** → click the red `generate-text` request → **Response** tab to see the JSON body; the `error` field usually explains the 500.
3. Ensure `.env` exists with `API_KEY=...` and that you’re on **http://localhost:8888**.

---

## 500 on `/.netlify/functions/generate-image` (image generation)

**What it means:** The image-generation function failed or timed out.

**Common causes:**

| Cause | What you see | Fix |
|-------|----------------|-----|
| **API key missing** | `API_KEY environment variable is not set` | Same as generate-text: add `API_KEY=...` to `.env`. |
| **Timeout** | `Task timed out after ... seconds` (in terminal) | 4K images need more time. `netlify.toml` sets `generate-image` timeout to **180s**. **Fully stop** `npm run dev:netlify` (Ctrl+C), then run it again so the CLI picks up the timeout. |
| **Gemini image model error** | Message about model not found, quota, or safety block | Check the **terminal** for the exact error. The model is `gemini-3-pro-image-preview`; ensure your API key has image-generation access. |
| **Unknown error** (in UI) | Previously the app showed “Unknown error” when the server returned non-JSON (e.g. HTML on timeout). | The app now shows the real error when possible. Check the **terminal** where `netlify dev` runs for the actual message. |

**What to do:** Check the **terminal** for the failing request log, and in the browser **Network** tab open the red `generate-image` request → **Response** to see the JSON `error` field.

---

## “Task timed out after 30.00 seconds” (generate-image)

**What it means:** Netlify Dev uses a **30-second** default function timeout. Image generation (especially 4K) can take 30–180+ seconds, so the function is killed before it finishes.

**Fixes in this project:**

1. **`netlify.toml`** – Per-function timeouts only: `[functions."generate-text"] timeout = 60` and `[functions."generate-image"] timeout = 180`. **Do not** add `timeout = 120` under the main `[functions]` block — that causes “Configuration property functions.timeout must be an object” and can crash the CLI.
2. **`package.json`** – `dev:netlify` sets `NETLIFY_FUNCTIONS_TIMEOUT=180` before `netlify dev` (in case the CLI reads it).

**If you still see 30s timeout:**

1. **Upgrade Netlify CLI** – Older versions ignore per-function timeout in dev. Run: `npm install -D netlify-cli@latest`, then **fully stop** (Ctrl+C) and run `npm run dev:netlify` again.
2. **Fully restart** – Config is read at startup; restart after changing `netlify.toml`.
3. **Run from project root** – `cd` to the repo root (where `netlify.toml` lives) before `npm run dev:netlify`.
4. **Temporary workaround** – Use **2K** (or 1K) in Image Room Global Constants for faster generations in dev; **4K** will work on Netlify deploy (180s from toml).

---

## “Configuration property functions.timeout must be an object”

**What it means:** Netlify CLI rejected your `netlify.toml` because `timeout` was set in a way it doesn’t accept.

**Fix:** Do **not** put a plain number under the main `[functions]` block, e.g. do **not** write:

```toml
[functions]
timeout = 120   # INVALID – causes this error
```

Use **per-function** blocks only:

```toml
[functions."generate-text"]
timeout = 60

[functions."generate-image"]
timeout = 180
```

Then restart `npm run dev:netlify`.
