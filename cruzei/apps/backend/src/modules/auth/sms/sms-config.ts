// Config do SMS lida do env. Funções puras (o validateEnv usa smsEnvProblems antes do Nest existir).
// Problemas saem só com o NOME da variável e o motivo, nunca com o valor.

import { normalizePhoneBR, phoneKindBR } from '@cruzei/shared-utils';

import { devShortcutsEnabled, isProduction } from '../../../config/security';

type Env = Record<string, string | undefined>;

export const SMS_DRIVERS = ['log', 'twilio', 'zenvia'] as const;
export type SmsDriver = (typeof SMS_DRIVERS)[number];

/** token de injeção da config (AuthModule) */
export const SMS_CONFIG = 'SMS_CONFIG';

export interface SmsLimits {
  phonePerHour: number;
  phonePerDay: number;
  ipPerHour: number;
  ipPerDay: number;
  /** teto global de envios por hora (freio de orçamento); 0 = sem teto */
  globalPerHour: number;
}

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  /** número Twilio em E.164; vazio quando usa Messaging Service */
  from: string | null;
  messagingServiceSid: string | null;
}

export interface ZenviaConfig {
  apiToken: string;
  /** remetente cadastrado na Zenvia */
  from: string;
}

export interface SmsConfig {
  driver: SmsDriver;
  twilio: TwilioConfig | null;
  zenvia: ZenviaConfig | null;
  /** número de revisão das lojas: código fixo, nunca manda SMS */
  review: { phone: string; code: string } | null;
  limits: SmsLimits;
  verify: { maxAttempts: number; lockS: number };
  /** prazo da chamada ao provedor (abaixo dos 15 s do axios do app) */
  timeoutMs: number;
  /** devCode na resposta e código no log: driver 'log' + NODE_ENV=development + DEV_SHORTCUTS=true */
  devCode: boolean;
  /** telefone mascarado no log do driver 'log' (nunca em produção) */
  logPhone: boolean;
  /** prefixo das chaves no Redis (os testes usam um próprio) */
  keyPrefix: string;
}

export const SMS_LIMIT_DEFAULTS: SmsLimits = {
  phonePerHour: 5,
  phonePerDay: 10,
  ipPerHour: 20,
  ipPerDay: 60,
  globalPerHour: 0,
};
export const SMS_VERIFY_DEFAULTS = { maxAttempts: 5, lockS: 900 } as const;
export const SMS_PROVIDER_TIMEOUT_MS = 8_000;

/** variável numérica: [nome, campo, mínimo, máximo] */
const LIMIT_VARS: ReadonlyArray<[string, keyof SmsLimits, number, number]> = [
  ['SMS_MAX_PER_PHONE_HOUR', 'phonePerHour', 1, 1_000],
  ['SMS_MAX_PER_PHONE_DAY', 'phonePerDay', 1, 1_000],
  ['SMS_MAX_PER_IP_HOUR', 'ipPerHour', 1, 100_000],
  ['SMS_MAX_PER_IP_DAY', 'ipPerDay', 1, 100_000],
  ['SMS_MAX_PER_HOUR_GLOBAL', 'globalPerHour', 0, 10_000_000],
];
const VERIFY_VARS: ReadonlyArray<[string, 'maxAttempts' | 'lockS', number, number]> = [
  ['SMS_VERIFY_MAX_ATTEMPTS', 'maxAttempts', 1, 20],
  ['SMS_VERIFY_LOCK_S', 'lockS', 60, 86_400],
];

const trimmed = (env: Env, name: string): string => (env[name] ?? '').trim();

/** inteiro dentro da faixa; vazio = padrão; fora da faixa/lixo = null (problema) */
function intVar(env: Env, name: string, def: number, min: number, max: number): number | null {
  const raw = trimmed(env, name);
  if (!raw) return def;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
}

/** driver pedido; vazio = 'log' fora de produção (em produção vazio é problema) */
function driverOf(env: Env): SmsDriver | 'invalid' | 'missing' {
  const raw = trimmed(env, 'SMS_DRIVER').toLowerCase();
  if (!raw) return isProduction(env) ? 'missing' : 'log';
  return (SMS_DRIVERS as readonly string[]).includes(raw) ? (raw as SmsDriver) : 'invalid';
}

/**
 * Código fixo fácil demais pra ser o da revisão: dígito repetido (000000), sequência (123456, 654321, 890123),
 * padrão curto repetido (121212, 123123) ou os manjados de teclado.
 */
export function isWeakCode(code: string): boolean {
  if (!/^\d{6}$/.test(code)) return true;
  const d = [...code].map(Number);
  const steps = d.slice(1).map((v, i) => (v - d[i]! + 10) % 10);
  if (steps.every((s) => s === steps[0]) && (steps[0] === 0 || steps[0] === 1 || steps[0] === 9))
    return true;
  if (code === code.slice(0, 2).repeat(3) || code === code.slice(0, 3).repeat(2)) return true;
  return ['112233', '102030', '147258', '159753', '258369', '123321', '010203'].includes(code);
}

/** número de revisão normalizado (+55…) quando é celular BR válido */
function reviewPhoneOf(env: Env): string | null {
  const raw = trimmed(env, 'REVIEW_PHONE');
  if (!raw || phoneKindBR(raw) !== 'mobile') return null;
  return normalizePhoneBR(raw);
}

/** o que impede o SMS de funcionar como configurado (vazio = ok). Vale em qualquer ambiente. */
export function smsEnvProblems(env: Env = process.env): string[] {
  const out: string[] = [];
  const driver = driverOf(env);
  if (driver === 'invalid') out.push('SMS_DRIVER inválido (use log, twilio ou zenvia)');
  if (driver === 'missing') out.push('SMS_DRIVER ausente em produção (use twilio ou zenvia)');
  if (driver === 'log' && isProduction(env))
    out.push('SMS_DRIVER=log em produção (use twilio ou zenvia)');
  if (driver === 'twilio') {
    if (!trimmed(env, 'TWILIO_ACCOUNT_SID')) out.push('TWILIO_ACCOUNT_SID ausente');
    if (!trimmed(env, 'TWILIO_AUTH_TOKEN')) out.push('TWILIO_AUTH_TOKEN ausente');
    const from = trimmed(env, 'TWILIO_FROM');
    const svc = trimmed(env, 'TWILIO_MESSAGING_SERVICE_SID');
    if (!from && !svc) out.push('TWILIO_FROM ou TWILIO_MESSAGING_SERVICE_SID ausente');
    if (from && !/^\+\d{8,15}$/.test(from)) out.push('TWILIO_FROM precisa estar em E.164 (+5511…)');
  }
  if (driver === 'zenvia') {
    if (!trimmed(env, 'ZENVIA_API_TOKEN')) out.push('ZENVIA_API_TOKEN ausente');
    if (!trimmed(env, 'ZENVIA_FROM')) out.push('ZENVIA_FROM ausente');
  }

  const phone = trimmed(env, 'REVIEW_PHONE');
  const code = trimmed(env, 'REVIEW_CODE');
  if (phone && !code) out.push('REVIEW_PHONE sem REVIEW_CODE');
  if (code && !phone) out.push('REVIEW_CODE sem REVIEW_PHONE');
  if (phone && !reviewPhoneOf(env)) out.push('REVIEW_PHONE precisa ser celular brasileiro com DDD');
  if (code && !/^\d{6}$/.test(code)) out.push('REVIEW_CODE precisa ter 6 dígitos');
  else if (code && isWeakCode(code))
    out.push('REVIEW_CODE fácil demais (sem sequência nem repetição)');

  for (const [name, , min, max] of [...LIMIT_VARS, ...VERIFY_VARS]) {
    if (intVar(env, name, min, min, max) === null)
      out.push(`${name} inválido (inteiro entre ${min} e ${max})`);
  }
  return out;
}

/** config tipada; nunca lança (valor ruim cai no padrão — o boot já recusou pelo smsEnvProblems) */
export function readSmsConfig(env: Env = process.env): SmsConfig {
  const d = driverOf(env);
  const driver: SmsDriver = d === 'invalid' || d === 'missing' ? 'log' : d;
  const limits = { ...SMS_LIMIT_DEFAULTS };
  for (const [name, key, min, max] of LIMIT_VARS) {
    limits[key] = intVar(env, name, SMS_LIMIT_DEFAULTS[key], min, max) ?? SMS_LIMIT_DEFAULTS[key];
  }
  const verify: { maxAttempts: number; lockS: number } = { ...SMS_VERIFY_DEFAULTS };
  for (const [name, key, min, max] of VERIFY_VARS) {
    verify[key] = intVar(env, name, SMS_VERIFY_DEFAULTS[key], min, max) ?? SMS_VERIFY_DEFAULTS[key];
  }
  const reviewPhone = reviewPhoneOf(env);
  const reviewCode = trimmed(env, 'REVIEW_CODE');
  return {
    driver,
    twilio:
      driver === 'twilio'
        ? {
            accountSid: trimmed(env, 'TWILIO_ACCOUNT_SID'),
            authToken: trimmed(env, 'TWILIO_AUTH_TOKEN'),
            from: trimmed(env, 'TWILIO_FROM') || null,
            messagingServiceSid: trimmed(env, 'TWILIO_MESSAGING_SERVICE_SID') || null,
          }
        : null,
    zenvia:
      driver === 'zenvia'
        ? { apiToken: trimmed(env, 'ZENVIA_API_TOKEN'), from: trimmed(env, 'ZENVIA_FROM') }
        : null,
    // só com os dois certos: número de revisão pela metade não existe
    review:
      reviewPhone && /^\d{6}$/.test(reviewCode) && !isWeakCode(reviewCode)
        ? { phone: reviewPhone, code: reviewCode }
        : null,
    limits,
    verify,
    timeoutMs: SMS_PROVIDER_TIMEOUT_MS,
    devCode: driver === 'log' && devShortcutsEnabled(env),
    logPhone: !isProduction(env),
    keyPrefix: 'sms',
  };
}

/** config do AuthModule: config errada derruba o boot (falha fechada) */
export function loadSmsConfig(env: Env = process.env): SmsConfig {
  const problems = smsEnvProblems(env);
  if (problems.length) throw new Error(`Config de SMS inválida: ${problems.join('; ')}`);
  return readSmsConfig(env);
}
