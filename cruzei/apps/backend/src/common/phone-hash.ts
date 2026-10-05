import { createHmac } from 'node:crypto';

import { normalizePhoneBR } from '@cruzei/shared-utils';
import { Logger } from '@nestjs/common';

import { DEV_PHONE_HASH_SECRET, isProduction } from '../config/security';

// Marca do telefone sem guardar o número: HMAC-SHA256 (hex, 64) do número normalizado com PHONE_HASH_SECRET.
// Usado no teste grátis do Premium (trial_claims: uma vez por número, sobrevive à exclusão/liberação da conta).
// Trocar o segredo zera as marcações. Produção exige o segredo forte (configuration.validateEnv).

export const DEV_SECRET = DEV_PHONE_HASH_SECRET;
let warned = false;

/** segredo do HMAC; em dev/test cai num padrão (com aviso uma vez); sem NODE_ENV conta como produção e lança */
export function phoneHashSecret(env: NodeJS.ProcessEnv = process.env): string {
  const s = env.PHONE_HASH_SECRET?.trim();
  if (s) return s;
  if (isProduction(env)) throw new Error('PHONE_HASH_SECRET ausente');
  if (!warned) {
    warned = true;
    new Logger('PhoneHash').warn(
      'PHONE_HASH_SECRET ausente — usando o padrão de dev. Defina um valor aleatório em produção.',
    );
  }
  return DEV_SECRET;
}

/** HMAC-SHA256 do telefone normalizado (+55…); o mesmo número em formatos diferentes dá a mesma marca */
export function phoneHash(phone: string, secret: string = phoneHashSecret()): string {
  const norm = normalizePhoneBR(phone) ?? phone.replace(/[^\d+]/g, '');
  return createHmac('sha256', secret).update(norm).digest('hex');
}
