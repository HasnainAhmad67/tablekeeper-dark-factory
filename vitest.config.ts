import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

export default defineConfig({
  // Vitest 5 transforms via Oxc and does not default the JSX runtime, so it
  // must be set explicitly for .tsx test files.
  oxc: {
    jsx: {
      runtime: 'automatic',
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
