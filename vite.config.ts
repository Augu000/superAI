import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { writeFileSync } from 'fs';
import { join } from 'path';

export default defineConfig(async () => {
  let netlifyPlugin: (() => unknown) | null = null;
  try {
    const mod = await import('@netlify/vite-plugin');
    netlifyPlugin = (mod as { default?: () => unknown }).default ?? mod;
  } catch {
    // @netlify/vite-plugin missing or broken (e.g. no dist/main.js); Netlify Dev will still proxy + run functions
  }

  return {
    plugins: [
      react({ jsxRuntime: 'automatic' }),
      ...(netlifyPlugin ? [netlifyPlugin()] : []),
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
    assetsInclude: ['**/*.html'],
  };
});
