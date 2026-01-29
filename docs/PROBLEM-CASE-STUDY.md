# Problem Case Study: Vite + Netlify Dev (MIME & Plugin)

## Symptoms

- **Browser:** “Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of `""`.”
- **Dev:** `Cannot find package '@netlify/vite-plugin'` when starting `npm run dev:netlify`.
- **Terminal:** Repeated “Rewrote URL to /index.html” while loading the app.

## Root Causes

1. **SPA redirect in dev**  
   A catch-all redirect (`/* → index.html`) was applied during `netlify dev`. Requests for `/index.tsx`, `/@vite/client`, and other JS modules were rewritten to `index.html`. The browser then received HTML where it expected JavaScript, so it reported an empty or wrong MIME type.

2. **Redirect source**  
   The redirect came from either `netlify.toml` `[[redirects]]` or from `dist/_redirects` (generated at build time). Netlify Dev loads both; if either had `/* → index.html`, every request was rewritten.

3. **Plugin resolution**  
   `@netlify/vite-plugin` is required by the Vite config. If the package was missing or installed without its `dist/` (broken publish or incomplete install), Node could not resolve the package and Vite failed to start.

## Fixes Applied

| Problem | Solution |
|--------|----------|
| SPA redirect in dev | Removed `[[redirects]]` from `netlify.toml`. SPA redirect is only in `dist/_redirects`, generated at **build** time by a Vite plugin. |
| Dev still applying redirect | `dev:netlify` now runs `rm -f dist/_redirects` before `netlify dev`, so no `_redirects` file exists during dev and Netlify Dev does not rewrite asset URLs. |
| Vite failing when plugin missing | Vite config loads `@netlify/vite-plugin` inside an async `defineConfig` with try/catch; on failure, Vite starts without the plugin. Netlify Dev still proxies to Vite and runs functions. |
| Production SPA routing | The `netlify-redirects` Vite plugin writes `dist/_redirects` in `closeBundle`, so production deploys still get `/* /index.html 200`. |

## Takeaways

- **Dev vs prod:** In dev, avoid applying the SPA catch-all so Vite can serve real JS/CSS; in prod, keep the redirect only in build output (`dist/_redirects`).
- **Optional plugin:** Making the Netlify plugin optional in the config keeps the dev server runnable even when the package is broken or missing.
- **Single origin:** Use `npm run dev:netlify` and open **http://localhost:8888** so the app and Netlify functions share the same origin and avoid CORS.
