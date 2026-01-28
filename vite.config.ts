
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react({
      jsxRuntime: 'automatic',
    }),
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
    hmr: process.env.NETLIFY_DEV ? {
      port: 3000,
    } : {
      protocol: 'ws',
      host: 'localhost',
    },
  },
  optimizeDeps: {
    exclude: ['index.html'],
    include: ['react', 'react-dom'],
  },
  assetsInclude: ['**/*.html'],
});
