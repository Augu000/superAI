import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { writeFileSync } from 'fs';
import { join } from 'path';

// Async config for dynamic Netlify plugin; cast needed for TS (UserConfigExport overload)
export default defineConfig((async () => {
  let netlifyPlugin: unknown = null;
  try {
    const mod = await import('@netlify/vite-plugin');
    const fn = (mod as { default?: unknown }).default ?? mod;
    netlifyPlugin = typeof fn === 'function' ? (fn as () => unknown)() : fn;
  } catch {
    // @netlify/vite-plugin missing or broken; Netlify Dev will still proxy + run functions
  }

  return {
    plugins: [
      react({ jsxRuntime: 'automatic' }),
      ...(netlifyPlugin != null ? [netlifyPlugin] : []),
      {
        name: 'netlify-redirects',
        closeBundle() {
          writeFileSync(join(__dirname, 'dist', '_redirects'), '/*    /index.html   200\n');
        },
      },
    ],
    build: {
      outDir: 'dist',
      rollupOptions: {
        input: {
          main: './index.html',
        },
      },
    },
    server: {
      port: 3000,
      strictPort: false,
    },
    optimizeDeps: {
      exclude: ['index.html'],
      include: ['react', 'react-dom'],
    },
  };
}) as Parameters<typeof defineConfig>[0]);
