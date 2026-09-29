import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// pasta do painel: raiz e .env daqui, de onde quer que o vite seja chamado (chamado de fora, o restart automático
// do vite perdia o alias '@' e o proxy da API)
const here = fileURLToPath(new URL('.', import.meta.url));

// Tipos do contrato direto do código-fonte: o dist do shared-types é CommonJS (feito pro Nest) e pode estar velho
const sharedTypes = fileURLToPath(new URL('../../packages/shared-types/src/index.ts', import.meta.url));

export default defineConfig(({ mode }) => {
  // METCH_API_TARGET: pra onde o proxy do dev manda /v1, /socket.io e /uploads (padrão: backend local na 3000).
  // 127.0.0.1 e não localhost: o backend escuta só IPv4 e o localhost do Windows pode resolver pra ::1 primeiro
  const env = loadEnv(mode, here, '');
  const target = env.METCH_API_TARGET || 'http://127.0.0.1:3000';

  return {
    root: here,
    plugins: [react()],
    resolve: {
      alias: {
        '@cruzei/shared-types': sharedTypes,
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
      // o monorepo é "hoisted": garante uma cópia só do React no bundle
      dedupe: ['react', 'react-dom'],
    },
    // porta própria (5180): a 5173 é disputada por outros apps de dev na máquina, e o navegador podia cair no app errado.
    // host 127.0.0.1: um endereço só (localhost no Windows resolve pra ::1 e 127.0.0.1, e cada um podia ser um app)
    server: {
      host: '127.0.0.1',
      port: 5180,
      strictPort: true,
      proxy: {
        '/v1': { target, changeOrigin: true },
        '/uploads': { target, changeOrigin: true },
        '/socket.io': { target, changeOrigin: true, ws: true },
      },
    },
    preview: { host: '127.0.0.1', port: 5180, strictPort: true },
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
