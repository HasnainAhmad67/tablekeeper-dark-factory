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
    // Remote-setup hooks (connection probes, fixture inserts, auth signups)
    // queue behind the same throttled host as the tests themselves; under
    // full-suite parallelism a 30s cap turned transient slowness in
    // group-writes' beforeAll into 8 skipped tests. 60s absorbs the jitter
    // without masking a genuinely hung setup (the hooks fail well before it).
    hookTimeout: 60000,
  },
});
