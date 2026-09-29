/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** origem da API em produção (ex.: https://api.metch.app); vazio = mesma origem do painel (proxy) */
  readonly VITE_API_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
