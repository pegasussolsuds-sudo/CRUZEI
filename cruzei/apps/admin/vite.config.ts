import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Tipos do contrato direto do código-fonte: o dist do shared-types é CommonJS (feito pro Nest) e pode estar velho
const sharedTypes = fileURLToPath(new URL('../../packages/shared-types/src/index.ts', import.meta.url));

export default defineConfig(({ mode }) => {
  // METCH_API_TARGET: pra onde o proxy do dev manda /v1, /socket.io e /uploads (padrão: backend local na 3000)
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.METCH_API_TARGET || 'http://localhost:3000';

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@cruzei/shared-types': sharedTypes,
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
      // o monorepo é "hoisted": garante uma cópia só do React no bundle
      dedupe: ['react', 'react-dom'],
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/v1': { target, changeOrigin: true },
        '/uploads': { target, changeOrigin: true },
        '/socket.io': { target, changeOrigin: true, ws: true },
      },
    },
    preview: { port: 5173, strictPort: true },
    build: {
      target: 'es2022',
      sourcemap: true,
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        output: {
          // mapa e gráficos são pesados e mudam pouco: ficam em arquivos próprios (cache do navegador)
          manualChunks: {
            maplibre: ['maplibre-gl'],
            charts: ['recharts'],
            react: ['react', 'react-dom', 'react-router', '@tanstack/react-query'],
          },
        },
      },
    },
  };
});
