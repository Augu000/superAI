/// <reference types="vite/client" />

interface ImportMetaEnv {
  // API key is now handled server-side via Netlify Functions
  // No client-side environment variables needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
