/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// NOTE: the repo root index.html is the live portfolio, served as-is by GitHub
// Pages. The React translator app will get its own HTML entry when the UI is
// built, so `vite build` never replaces the portfolio.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
