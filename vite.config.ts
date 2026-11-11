import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
  build: { chunkSizeWarningLimit: 1200 },
});
