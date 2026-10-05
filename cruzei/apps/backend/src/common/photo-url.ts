// Fotos: o banco guarda a CHAVE do objeto no storage (p/<uuid>.jpg) e o servidor monta a URL pública na saída.
// Funções puras (sem DI): usadas em mappers, SQL cru e scripts. URL absoluta gravada (legado ou externa) passa direto.
import { randomUUID } from 'node:crypto';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** chave aceita pelo storage: minúsculas, sem '..' nem '//', com extensão */
const KEY_RE = /^[a-z0-9][a-z0-9/_-]*\.[a-z0-9]{1,5}$/;
/**
 * chave que o GC pode apagar: p/<uuid>.jpg, p/<uuid>-t.jpg, o legado <uuid>.<ext> / <uuid>-t.jpg na raiz e a cópia
 * privada da foto retida por denúncia (held/<uuid>.<ext>)
 */
const MANAGED_RE = new RegExp(`^(p/|held/)?${UUID}(-t\\.jpg|\\.[a-z0-9]{1,5})$`);
const ABSOLUTE_RE = /^https?:\/\//i;
/** URL legada servida pelo próprio backend: http(s)://<qualquer host>/uploads/<chave> */
const LEGACY_PREFIX_RE = /^https?:\/\/[^/]+\/uploads\//i;

export const PHOTO_KEY_MAX = 200;

/**
 * Prefixo da foto retida por denúncia de menor/abuso infantil: nunca vira URL pública (photoUrl devolve null), o
 * /uploads recusa e no bucket fica fora do acesso público. Só a moderação lê, pela rota autenticada.
 */
export const HELD_PREFIX = 'held/';

/** tipo do arquivo pela extensão da chave (as fotos novas são sempre JPEG; o legado pode ser png/webp/heic) */
const IMAGE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};

export function isValidKey(k: unknown): k is string {
  return (
    typeof k === 'string' &&
    k.length > 0 &&
    k.length <= PHOTO_KEY_MAX &&
    KEY_RE.test(k) &&
    !k.includes('..') &&
    !k.includes('//')
  );
}

/** só essas chaves são apagadas do storage (fakes/ do seed e URL externa nunca) */
export function isManagedKey(k: unknown): k is string {
  return isValidKey(k) && MANAGED_RE.test(k);
}

/** chaves de um upload novo (original + miniatura) */
export function newPhotoKeys(): { key: string; thumbKey: string } {
  const id = randomUUID();
  return { key: `p/${id}.jpg`, thumbKey: `p/${id}-t.jpg` };
}

export function isHeldKey(k: unknown): boolean {
  return typeof k === 'string' && k.startsWith(HELD_PREFIX);
}

/**
 * Chave da cópia privada de uma foto retida: uuid NOVO (a URL pública antiga não leva até ela) e a mesma extensão
 * do original (os bytes são copiados como estão).
 */
export function newHeldKey(sourceKey: string): string {
  const ext = sourceKey.split('.').pop()?.toLowerCase() ?? '';
  return `${HELD_PREFIX}${randomUUID()}.${IMAGE_TYPES[ext] ? ext : 'jpg'}`;
}

export function imageContentType(key: string): string {
  return IMAGE_TYPES[key.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

let cachedBase: string | null = null;

/**
 * Base pública das fotos (STORAGE_PUBLIC_BASE_URL sem barra final). Fora de produção o padrão é o /uploads do próprio
 * backend: PUBLIC_BASE_URL (o mesmo do seed-dev, pra LAN) ou 127.0.0.1 (celular pelo adb reverse). Produção sem
 * STORAGE_PUBLIC_BASE_URL nem sobe (storageConfigFromEnv).
 */
export function photoBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env === process.env && cachedBase) return cachedBase;
  const raw = (env.STORAGE_PUBLIC_BASE_URL ?? '').trim().replace(/\/+$/, '');
  const lan = (env.PUBLIC_BASE_URL ?? '').trim().replace(/\/+$/, '');
  const base = raw || (lan ? `${lan}/uploads` : `http://127.0.0.1:${env.PORT || 3000}/uploads`);
  if (env === process.env) cachedBase = base;
  return base;
}

/** host da base pública (entra na lista do assertPhotoHost) */
export function photoBaseHost(env: NodeJS.ProcessEnv = process.env): string | null {
  try {
    return new URL(photoBaseUrl(env)).host.toLowerCase();
  } catch {
    return null;
  }
}

/** testes: relê o env */
export function resetPhotoUrlCache(): void {
  cachedBase = null;
}

/**
 * URL pública de uma foto gravada no banco. null → null; URL absoluta (legado/externa) passa direto; chave vira
 * `${BASE}/${segmentos codificados}`. Caminho estranho (absoluto, '..', '//', '\') devolve null em vez de montar lixo.
 * Foto retida (held/) também devolve null: nunca sai como URL pública.
 */
export function photoUrl(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (ABSOLUTE_RE.test(stored)) return stored;
  if (
    isHeldKey(stored) ||
    stored.startsWith('/') ||
    stored.includes('..') ||
    stored.includes('//') ||
    stored.includes('\\')
  )
    return null;
  return `${photoBaseUrl()}/${stored.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * Chave de uma URL de foto: aceita a própria chave, `${BASE}/<chave>` e o legado http(s)://<host>/uploads/<chave>
 * (qualquer host: a chave só aponta pro NOSSO storage e anexar exige posse em media_objects). Querystring, fragmento,
 * credenciais, traversal ou outro caminho → null.
 */
export function keyFromPhotoUrl(url: string | null | undefined): string | null {
  if (!url || url.length > 1000) return null;
  if (!ABSOLUTE_RE.test(url)) return isValidKey(url) ? url : null;
  if (/[?#]/.test(url)) return null;
  const base = photoBaseUrl();
  let rest: string;
  if (url.startsWith(`${base}/`)) {
    rest = url.slice(base.length + 1);
  } else if (LEGACY_PREFIX_RE.test(url)) {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    if (u.username || u.password) return null;
    rest = url.replace(LEGACY_PREFIX_RE, '');
  } else {
    return null;
  }
  let key: string;
  try {
    key = decodeURIComponent(rest);
  } catch {
    return null;
  }
  return isValidKey(key) ? key : null;
}
