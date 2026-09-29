import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

// Testes só das funções puras (src/lib): ambiente node, sem DOM
export default defineConfig({
  resolve: {
    alias: {
      '@cruzei/shared-types': fileURLToPath(new URL('../../packages/shared-types/src/index.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
