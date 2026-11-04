/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { input: { portfolio: resolve('index.html'), translator: resolve('translator/index.html') } } },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
