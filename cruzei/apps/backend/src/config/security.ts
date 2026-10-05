// Regras de ambiente e segurança lidas do env. Funções puras, sem Nest: o instrument.ts importa antes do Nest existir.
// Princípio: ambiente ausente ou desconhecido conta como PRODUÇÃO; atalho de dev exige NODE_ENV=development E
// DEV_SHORTCUTS=true. Nenhuma função aqui devolve valor de segredo — só nome e motivo.

type Env = Record<string, string | undefined>;

export type AppEnv = 'development' | 'test' | 'production';

/** development | test | production; ausente, vazio ou desconhecido ('prod', 'staging') vira production */
export function appEnv(env: Env = process.env): AppEnv {
  const v = (env.NODE_ENV ?? '').trim().toLowerCase();
  return v === 'development' || v === 'test' ? v : 'production';
}

export function isProduction(env: Env = process.env): boolean {
  return appEnv(env) === 'production';
}

/**
 * Atalhos de dev (devCode na resposta, código do SMS no log, recibo 'dev'): só com NODE_ENV=development E
 * DEV_SHORTCUTS=true. NODE_ENV=test também fica sem (os testes ligam o que precisam).
 */
export function devShortcutsEnabled(env: Env = process.env): boolean {
  return appEnv(env) === 'development' && env.DEV_SHORTCUTS?.trim() === 'true';
}

// ---- Segredos ----

export const SECRET_MIN_LENGTH = 32;
/** mínimo de caracteres distintos: barra 'aaaa…' e '1234…' repetido */
export const SECRET_MIN_DISTINCT = 8;

/** padrão de dev do HMAC do telefone (common/phone-hash) */
export const DEV_PHONE_HASH_SECRET = 'metch-dev-phone-hash-nao-usar-em-producao';
/** mesmo literal do DEV_SALT de modules/location/location.service.ts (duplicado de propósito) */
export const DEV_LOCATION_SALT = 'cruzei-dev-salt';
/** JWT_SECRET do .env.example */
export const EXAMPLE_JWT_SECRET = 'change-me-in-prod-this-is-a-dev-secret-32chars-min';

export const KNOWN_WEAK_SECRETS: ReadonlySet<string> = new Set([
  EXAMPLE_JWT_SECRET,
  DEV_PHONE_HASH_SECRET,
  DEV_LOCATION_SALT,
]);

const PLACEHOLDER_RE =
  /change[-_ ]?me|n[aã]o[-_ ]?usar|placeholder|exemplo|example|your[-_ ]?secret/i;

/** segredos que produção exige fortes e distintos */
export const PRODUCTION_SECRETS = ['JWT_SECRET', 'LOCATION_SALT', 'PHONE_HASH_SECRET'] as const;

/** problemas de um segredo (vazio = ok). Só nome e motivo, nunca o valor. */
export function secretProblems(name: string, value: string | undefined): string[] {
  const v = (value ?? '').trim();
  if (!v) return [`${name} ausente`];
  if (KNOWN_WEAK_SECRETS.has(v)) return [`${name} é valor de exemplo/dev`];
  const out: string[] = [];
  if (v.length < SECRET_MIN_LENGTH)
    out.push(`${name} curto (mín. ${SECRET_MIN_LENGTH} caracteres)`);
  if (PLACEHOLDER_RE.test(v)) out.push(`${name} parece placeholder`);
  if (new Set(v).size < SECRET_MIN_DISTINCT)
    out.push(`${name} com pouca variedade (mín. ${SECRET_MIN_DISTINCT} caracteres distintos)`);
  return out;
}

/** nomes de segredos com o mesmo valor (ex.: ['JWT_SECRET e PHONE_HASH_SECRET']) */
export function repeatedSecrets(env: Env, names: readonly string[] = PRODUCTION_SECRETS): string[] {
  const seen = new Map<string, string>();
  const out: string[] = [];
  for (const n of names) {
    const v = env[n]?.trim();
    if (!v) continue;
    const first = seen.get(v);
    if (first) out.push(`${first} e ${n}`);
    else seen.set(v, n);
  }
  return out;
}

// ---- Origens (CORS do HTTP e do socket) ----

/** padrão fora de produção quando nada foi configurado (Expo web e Metro) */
export const DEV_DEFAULT_ORIGINS: readonly string[] = [
  'http://localhost:8081',
  'http://localhost:19006',
];

/** origem exata normalizada (https://admin.metch.app) ou null ('*', 'null', path, query, curinga, URL inválida) */
export function normalizeOrigin(raw: string): string | null {
  const o = raw.trim();
  if (!o || o === '*' || o.toLowerCase() === 'null') return null;
  let u: URL;
  try {
    u = new URL(o);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password || u.search || u.hash || u.hostname.includes('*')) return null;
  if (u.pathname !== '/' && u.pathname !== '') return null;
  return u.origin;
}

export type ParsedOrigins = { origins: string[]; invalid: string[] };

/** lista separada por vírgula → origens normalizadas (sem repetição) + entradas recusadas */
export function parseOrigins(raw: string | undefined): ParsedOrigins {
  const origins: string[] = [];
  const invalid: string[] = [];
  for (const part of (raw ?? '').split(',')) {
    const p = part.trim();
    if (!p) continue;
    const o = normalizeOrigin(p);
    if (!o) invalid.push(p.length > 80 ? `${p.slice(0, 80)}…` : p);
    else if (!origins.includes(o)) origins.push(o);
  }
  return { origins, invalid };
}

/** qual variável define as origens: ALLOWED_ORIGINS; CORS_ORIGINS é alias legado */
export function allowedOriginsVar(
  env: Env = process.env,
): 'ALLOWED_ORIGINS' | 'CORS_ORIGINS' | null {
  if (env.ALLOWED_ORIGINS?.trim()) return 'ALLOWED_ORIGINS';
  if (env.CORS_ORIGINS?.trim()) return 'CORS_ORIGINS';
  return null;
}

/**
 * Origens de navegador aceitas. Sem nada configurado: localhost do Expo fora de produção; em produção, nenhuma
 * (basta se o painel estiver na mesma origem da API, atrás do proxy).
 */
export function resolveAllowedOrigins(env: Env = process.env): string[] {
  const name = allowedOriginsVar(env);
  const { origins } = parseOrigins(name ? env[name] : undefined);
  if (origins.length) return origins;
  return isProduction(env) ? [] : [...DEV_DEFAULT_ORIGINS];
}

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Origin aceito no socket? Sem Origin (cliente nativo/servidor) sim; na lista sim; mesmo host da requisição sim
 * (o WebSocket do RN manda Origin igual à URL do próprio servidor, e o painel pode estar na mesma origem).
 * `hosts`: Host e X-Forwarded-Host — navegador não consegue forjar nenhum dos dois num WebSocket.
 */
export function originAllowed(
  origin: string | string[] | undefined,
  allowed: ReadonlySet<string>,
  hosts: ReadonlyArray<string | string[] | undefined> = [],
): boolean {
  const raw = Array.isArray(origin) ? origin[0] : origin;
  if (raw === undefined || raw.trim() === '') return true;
  const o = normalizeOrigin(raw);
  if (!o) return false;
  if (allowed.has(o)) return true;
  const host = hostOf(o);
  if (!host) return false;
  return hosts
    .flatMap((h) => (Array.isArray(h) ? h : [h]))
    .flatMap((h) => (h ?? '').split(','))
    .some((h) => h.trim().toLowerCase() === host);
}

// ---- Produção ----

/** senha do DATABASE_URL é a de exemplo (docker-compose/.env.example)? */
export function databaseUsesExamplePassword(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return decodeURIComponent(new URL(url).password) === 'cruzei_dev';
  } catch {
    return false;
  }
}

/**
 * Problemas que impedem produção de subir (vazio = ok): segredos fortes e distintos, origens exatas em https e senha
 * de exemplo do Postgres. As travas de foto e dados legais ficam no validateEnv (evita import circular).
 */
export function productionProblems(env: Env = process.env): string[] {
  const out: string[] = [];
  for (const name of PRODUCTION_SECRETS) out.push(...secretProblems(name, env[name]));
  for (const pair of repeatedSecrets(env)) out.push(`${pair} iguais (use segredos distintos)`);

  const name = allowedOriginsVar(env);
  if (name) {
    const { origins, invalid } = parseOrigins(env[name]);
    if (invalid.length)
      out.push(
        `${name} com entrada inválida (origem exata, sem '*', path ou query): ${invalid.join(', ')}`,
      );
    const plain = origins.filter((o) => !o.startsWith('https://'));
    if (plain.length) out.push(`${name} só aceita https em produção: ${plain.join(', ')}`);
  }

  if (databaseUsesExamplePassword(env.DATABASE_URL))
    out.push('DATABASE_URL usa a senha de exemplo (cruzei_dev)');
  return out;
}
