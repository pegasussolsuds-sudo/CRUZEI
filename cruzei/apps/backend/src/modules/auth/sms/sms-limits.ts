// Estado do SMS no Redis: código (HMAC), espera entre pedidos, tetos de envio, erros e trava.
// Chaves por pk = phoneHash(telefone) — telefone cru nunca aparece em chave — e IP também vai com HMAC.

import { isIP } from 'node:net';

/** validade do código */
export const CODE_TTL_S = 300;
/** espera entre dois pedidos do mesmo número */
export const RESEND_COOLDOWN_S = 30;
/** janela do contador de erros (código novo NÃO zera: pedir outro SMS não devolve as chances) */
export const FAILS_WINDOW_S = 3_600;
export const HOUR_S = 3_600;
export const DAY_S = 86_400;

export interface PhoneKeys {
  /** HMAC do código (EX CODE_TTL_S) */
  code: string;
  /** espera entre pedidos (EX RESEND_COOLDOWN_S) */
  last: string;
  /** erros de código (EX FAILS_WINDOW_S) */
  fails: string;
  /** trava depois de N erros */
  lock: string;
  /** envios na hora / no dia */
  hour: string;
  day: string;
}

export function phoneKeys(prefix: string, pk: string): PhoneKeys {
  return {
    code: `${prefix}:c:${pk}`,
    last: `${prefix}:last:${pk}`,
    fails: `${prefix}:f:${pk}`,
    lock: `${prefix}:lock:${pk}`,
    hour: `${prefix}:n:h:${pk}`,
    day: `${prefix}:n:d:${pk}`,
  };
}

/** envios por conexão; sem IP conhecido as chaves existem mas o script ignora (hasIp = 0) */
export function ipKeys(prefix: string, ipKey: string | null): { hour: string; day: string } {
  const k = ipKey ?? 'none';
  return { hour: `${prefix}:ip:h:${k}`, day: `${prefix}:ip:d:${k}` };
}

export const globalHourKey = (prefix: string) => `${prefix}:g:h`;

/** IPv6 com '::' → 8 grupos de 4 dígitos hex */
function expandIPv6(ip: string): string[] | null {
  const [head, tail, extra] = ip.split('::');
  if (extra !== undefined) return null;
  const h = head ? head.split(':') : [];
  const t = tail !== undefined ? (tail ? tail.split(':') : []) : [];
  const missing = 8 - h.length - t.length;
  if (tail === undefined ? missing !== 0 : missing < 1) return null;
  const groups = [...h, ...Array<string>(tail === undefined ? 0 : missing).fill('0'), ...t];
  return groups.map((g) => g.toLowerCase().padStart(4, '0'));
}

/**
 * Balde do IP pros tetos: IPv4 como está (IPv4 mapeado em IPv6 vira IPv4); IPv6 agrupado por /64 (a operadora dá
 * um /64 inteiro pra cada aparelho, e trocar o final do endereço não pode furar o teto). Sem IP = null.
 */
export function ipBucket(ip: string | null | undefined): string | null {
  const raw = (ip ?? '').trim().replace(/%.*$/, '');
  if (!raw) return null;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(raw);
  if (mapped) return mapped[1]!;
  const v = isIP(raw);
  if (v === 4) return raw;
  if (v !== 6) return null;
  // IPv6 com IPv4 no fim (::ffff:0:1.2.3.4 etc.): o /64 vem da parte hex
  const hex = raw.includes('.') ? raw.replace(/:[^:]*$/, ':0:0') : raw;
  const groups = expandIPv6(hex);
  return groups ? `${groups.slice(0, 4).join(':')}::/64` : null;
}

/** espera legível em pt-BR: '45 s', '15 min', '1 h', '2 h 30 min' */
export function humanWait(seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

// ---- scripts Lua (atômicos: rajada em paralelo não fura teto nem compara além do limite) ----

/** resultado do SEND */
export const SEND_OK = 0;
export const SEND_LOCKED = 1;
export const SEND_COOLDOWN = 2;
export const SEND_PHONE_LIMIT = 3;
export const SEND_IP_LIMIT = 4;
export const SEND_GLOBAL_LIMIT = 5;

/**
 * Confere TUDO antes de contar (pedido recusado não gasta cota) e, se passa, conta e grava a espera.
 * KEYS: 1 lock, 2 last, 3 nº hora, 4 nº dia, 5 ip hora, 6 ip dia, 7 global hora
 * ARGV: 1 espera(s), 2 máx nº hora, 3 máx nº dia, 4 máx ip hora, 5 máx ip dia, 6 máx global (0 = sem),
 *       7 tem IP (1/0), 8 conta nos tetos (1/0; 0 = número de revisão)
 * Devolve {status, segundos até liberar}.
 */
export const SEND_LUA = `
local t = redis.call('TTL', KEYS[1])
if t > 0 then return {1, t} end
t = redis.call('TTL', KEYS[2])
if t > 0 then return {2, t} end
local function over(key, max, window)
  max = tonumber(max)
  if max <= 0 then return 0 end
  local n = tonumber(redis.call('GET', key) or '0')
  if n < max then return 0 end
  local ttl = redis.call('TTL', key)
  if ttl < 0 then
    redis.call('EXPIRE', key, window)
    ttl = window
  end
  return ttl
end
local function bump(key, window)
  local n = redis.call('INCR', key)
  if n == 1 or redis.call('TTL', key) < 0 then redis.call('EXPIRE', key, window) end
end
if ARGV[8] == '1' then
  t = over(KEYS[4], ARGV[3], 86400)
  if t == 0 then t = over(KEYS[3], ARGV[2], 3600) end
  if t > 0 then return {3, t} end
  if ARGV[7] == '1' then
    t = over(KEYS[6], ARGV[5], 86400)
    if t == 0 then t = over(KEYS[5], ARGV[4], 3600) end
    if t > 0 then return {4, t} end
  end
  t = over(KEYS[7], ARGV[6], 3600)
  if t > 0 then return {5, t} end
  bump(KEYS[3], 3600)
  bump(KEYS[4], 86400)
  if ARGV[7] == '1' then
    bump(KEYS[5], 3600)
    bump(KEYS[6], 86400)
  end
  if tonumber(ARGV[6]) > 0 then bump(KEYS[7], 3600) end
end
redis.call('SET', KEYS[2], '1', 'EX', ARGV[1])
return {0, 0}
`;

/**
 * Provedor recusou de vez (4xx/número recusado): devolve a cota, apaga a espera e o código gravado agora (só se
 * ainda for o nosso). Timeout/rede não passa por aqui: o SMS pode ter saído.
 * KEYS: 1 last, 2 código, 3 nº hora, 4 nº dia, 5 ip hora, 6 ip dia, 7 global hora
 * ARGV: 1 HMAC gravado, 2 tem IP (1/0), 3 teto global ligado (1/0)
 */
export const REFUND_LUA = `
redis.call('DEL', KEYS[1])
if redis.call('GET', KEYS[2]) == ARGV[1] then redis.call('DEL', KEYS[2]) end
local function back(key)
  if redis.call('EXISTS', key) == 1 then
    if redis.call('DECR', key) <= 0 then redis.call('DEL', key) end
  end
end
back(KEYS[3])
back(KEYS[4])
if ARGV[2] == '1' then
  back(KEYS[5])
  back(KEYS[6])
end
if ARGV[3] == '1' then back(KEYS[7]) end
return 1
`;

/** resultado do VERIFY */
export const VERIFY_OK = 0;
export const VERIFY_LOCKED = 1;
export const VERIFY_EXPIRED = 2;
export const VERIFY_INVALID = 3;

/**
 * Confere o código. Travado → {1, ttl}; sem código → {2, 0} (não conta tentativa); certo → apaga código, erros e
 * espera → {0, 0}; errado → conta; no N-ésimo erro apaga código e erros e trava → {1, lock}; antes → {3, restantes}.
 * KEYS: 1 lock, 2 código, 3 erros, 4 last
 * ARGV: 1 HMAC do código digitado, 2 máx tentativas, 3 trava(s), 4 janela dos erros(s)
 */
export const VERIFY_LUA = `
local t = redis.call('TTL', KEYS[1])
if t > 0 then return {1, t} end
local stored = redis.call('GET', KEYS[2])
if not stored then return {2, 0} end
if stored == ARGV[1] then
  redis.call('DEL', KEYS[2], KEYS[3], KEYS[4])
  return {0, 0}
end
local n = redis.call('INCR', KEYS[3])
if n == 1 or redis.call('TTL', KEYS[3]) < 0 then redis.call('EXPIRE', KEYS[3], ARGV[4]) end
local max = tonumber(ARGV[2])
if n >= max then
  redis.call('DEL', KEYS[2], KEYS[3])
  redis.call('SET', KEYS[1], '1', 'EX', ARGV[3])
  return {1, tonumber(ARGV[3])}
end
return {3, max - n}
`;
