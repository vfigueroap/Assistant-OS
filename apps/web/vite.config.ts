import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  plugins: [react()],
  resolve: { alias: { '@assistant-os/domain': fileURLToPath(new URL('../../packages/domain/src/index.ts', import.meta.url)) } },
  build: { outDir: '../../dist', emptyOutDir: true, sourcemap: false },
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } }
});
