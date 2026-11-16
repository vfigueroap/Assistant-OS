import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: process.env.VERCEL ? '/web/' : '/',
  root: fileURLToPath(new URL('.', import.meta.url)),
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  plugins: [react()],
  resolve: { alias: { '@personal-ai-os/domain': fileURLToPath(new URL('../../packages/domain/src/index.ts', import.meta.url)) } },
  build: { outDir: '../../dist/web', emptyOutDir: true, sourcemap: false },
  server: { proxy: { '/api': `http://127.0.0.1:${process.env.API_PORT ?? 8787}`, '/gym/api': `http://127.0.0.1:${process.env.API_PORT ?? 8787}`, '/gym': `http://127.0.0.1:${process.env.API_PORT ?? 8787}` } }
});
