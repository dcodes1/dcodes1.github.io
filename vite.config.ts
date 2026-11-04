/// <reference types="vitest/config" />
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The repository root index.html is the live portfolio, served as-is by GitHub
// Pages (no build step on the server). The translator UI is built from
// src/app/main.tsx into translator/app/ and committed; the portfolio's router
// imports /translator/app/translator.js the first time the translator view
// opens, so the portfolio itself never loads React, the engine or the index.
export default defineConfig({
  plugins: [react()],
  base: '/translator/app/',
  publicDir: false,
  build: {
    outDir: 'translator/app',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
    reportCompressedSize: false,
    rollupOptions: {
      input: resolve(import.meta.dirname, 'src/app/main.tsx'),
      output: {
        entryFileNames: 'translator.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
