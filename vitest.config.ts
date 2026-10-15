import { defineConfig } from 'vitest/config';

/**
 * Tests exercise the deterministic engine directly (no DOM, no worker), so they
 * run in plain Node with the platform Web Crypto / TextDecoder globals.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30000,
  },
});
