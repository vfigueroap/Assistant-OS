import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@assistant-os/domain': fileURLToPath(new URL('./packages/domain/src/index.ts', import.meta.url)), '@personal-ai-os/domain': fileURLToPath(new URL('./packages/domain/src/index.ts', import.meta.url)) } },
  test: { include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'tests/**/*.test.ts'], exclude: ['vendor/**', 'node_modules/**', 'tests/e2e/**'], testTimeout: 30000, hookTimeout: 60000, maxWorkers: 2 }
});
