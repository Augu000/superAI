import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

export default defineConfig(async () => {
  // Try to load Netlify's Vite plugin if present.
  // If missing/broken, Netlify Dev will still proxy the frontend + run functions.
  let netlifyPlugin: unknown = null;

  try {
    const mod = await import("@netlify/vite-plugin");
    const candidate = (mod as { default?: unknown }).default ?? mod;
    netlifyPlugin = typeof candidate === "function" ? (candidate as () => unknown)() : candidate;
  } catch {
    netlifyPlugin = null;
  }

  return {
    plugins: [
      react({ jsxRuntime: "automatic" }),

      ...(netlifyPlugin ? [netlifyPlugin as any] : []),

      // Write SPA redirects for production build only.
      {
        name: "netlify-redirects",
        apply: "build",
        closeBundle() {
          const distDir = join(__dirname, "dist");
          mkdirSync(distDir, { recursive: true });
          writeFileSync(join(distDir, "_redirects"), "/*    /index.html   200\n", "utf8");
        },
      },
    ],

    build: {
      outDir: "dist",
      rollupOptions: {
        input: {
          main: "./index.html",
        },
      },
    },

    server: {
      port: 3000,
      strictPort: false,
    },

    optimizeDeps: {
      exclude: ["index.html"],
      include: ["react", "react-dom"],
    },
  };
});
