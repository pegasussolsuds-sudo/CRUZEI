import { createHmac, randomInt } from 'node:crypto';

import type { RequestCodeResponse } from '@cruzei/shared-types';
import { normalizePhoneBR, phoneKindBR } from '@cruzei/shared-utils';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { phoneHash, phoneHashSecret } from '../../common/phone-hash';
import { maskPhone } from '../../common/phone-mask';
import { RedisService } from '../../redis/redis.service';

import { SMS_CONFIG, type SmsConfig } from './sms/sms-config';
import {
  codeExpired,
  codeInvalid,
  phoneInvalid,
  phoneNotMobile,
  phoneUnreachable,
  smsCooldown,
  smsLocked,
  smsRateLimited,
  smsUnavailable,
} from './sms/sms-errors';
import {
  CODE_TTL_S,
  FAILS_WINDOW_S,
  globalHourKey,
  ipBucket,
  ipKeys,
  phoneKeys,
  REFUND_LUA,
  RESEND_COOLDOWN_S,
  SEND_COOLDOWN,
  SEND_GLOBAL_LIMIT,
  SEND_IP_LIMIT,
  SEND_LOCKED,
  SEND_LUA,
  SEND_PHONE_LIMIT,
  VERIFY_EXPIRED,
  VERIFY_INVALID,
  VERIFY_LOCKED,
  VERIFY_LUA,
  VERIFY_OK,
} from './sms/sms-limits';
import {
  isExplicitRefusal,
  SMS_PROVIDER,
  SmsSendError,
  type SmsProvider,
} from './sms/sms-provider';

type Pair = [number, number];
type LuaCmd = (...args: Array<string | number>) => Promise<unknown>;
interface SmsCommands {
  metchSmsSend: LuaCmd;
  metchSmsRefund: LuaCmd;
  metchSmsVerify: LuaCmd;
}

/** texto do SMS: só ASCII (GSM-7) pra caber em 1 segmento — acento vira UCS-2 e pode dobrar o custo */
export function smsText(code: string): string {
  return `Metch: seu codigo e ${code}. Nao passe pra ninguem. Vale 5 min.`;
}

/** 6 dígitos de fonte criptográfica (inclui os que começam com 0) */
export function randomSmsCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

const toPair = (r: unknown): Pair => {
  const [a, b] = (r as [unknown, unknown]) ?? [];
  return [Number(a), Number(b)];
};

/**
 * Código de login por SMS. No Redis só vai o HMAC do código (chave PHONE_HASH_SECRET) e as chaves usam o hash do
 * telefone. Espera entre pedidos, tetos por número/IP/global e trava por erros ficam em scripts Lua atômicos
 * (sms/sms-limits.ts). Número de revisão das lojas: código fixo, sem SMS e sem teto (mas com tentativas e trava).
 * Logs nunca levam telefone nem código em produção.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly cmd: SmsCommands;
  private lastGlobalWarn = 0;

  constructor(
    private readonly redis: RedisService,
    @Inject(SMS_PROVIDER) private readonly provider: SmsProvider,
    @Inject(SMS_CONFIG) private readonly cfg: SmsConfig,
  ) {
    const client = redis.client as Redis & Partial<SmsCommands>;
    if (typeof client.metchSmsSend !== 'function')
      client.defineCommand('metchSmsSend', { numberOfKeys: 7, lua: SEND_LUA });
    if (typeof client.metchSmsRefund !== 'function')
      client.defineCommand('metchSmsRefund', { numberOfKeys: 7, lua: REFUND_LUA });
    if (typeof client.metchSmsVerify !== 'function')
      client.defineCommand('metchSmsVerify', { numberOfKeys: 4, lua: VERIFY_LUA });
    this.cmd = client as unknown as SmsCommands;
    if (cfg.review) {
      this.logger.warn(
        `número de revisão das lojas ativo (${cfg.logPhone ? maskPhone(cfg.review.phone) : 'número oculto'}): código fixo, nunca manda SMS`,
      );
    }
  }

  /** é o número de revisão das lojas (REVIEW_PHONE)? Sem config, nenhum número é */
  isReviewPhone(phone: string): boolean {
    return !!this.cfg.review && normalizePhoneBR(phone) === this.cfg.review.phone;
  }

  async sendCode(rawPhone: string, ip?: string | null): Promise<RequestCodeResponse> {
    const phone = normalizePhoneBR(rawPhone ?? '');
    if (!phone) throw phoneInvalid();
    const review = this.isReviewPhone(phone);
    if (!review) {
      const kind = phoneKindBR(phone);
      if (kind === 'landline') throw phoneNotMobile();
      if (kind !== 'mobile') throw phoneInvalid();
    }

    const { keyPrefix: prefix, limits } = this.cfg;
    const keys = phoneKeys(prefix, this.pk(phone));
    const bucket = ipBucket(ip);
    const ipk = ipKeys(prefix, bucket ? this.ipKey(bucket) : null);
    const hasIp = bucket ? '1' : '0';
    const [status, wait] = toPair(
      await this.cmd.metchSmsSend(
        keys.lock,
        keys.last,
        keys.hour,
        keys.day,
        ipk.hour,
        ipk.day,
        globalHourKey(prefix),
        RESEND_COOLDOWN_S,
        limits.phonePerHour,
        limits.phonePerDay,
        limits.ipPerHour,
        limits.ipPerDay,
        limits.globalPerHour,
        hasIp,
        review ? '0' : '1',
      ),
    );
    if (status === SEND_LOCKED) throw smsLocked(wait);
    if (status === SEND_COOLDOWN) throw smsCooldown(wait);
    if (status === SEND_PHONE_LIMIT) throw smsRateLimited('phone', wait);
    if (status === SEND_IP_LIMIT) throw smsRateLimited('ip', wait);
    if (status === SEND_GLOBAL_LIMIT) {
      // um aviso por minuto, não um por pedido recusado
      if (Date.now() - this.lastGlobalWarn > 60_000) {
        this.lastGlobalWarn = Date.now();
        this.logger.warn(
          `teto global de SMS da hora atingido (SMS_MAX_PER_HOUR_GLOBAL=${limits.globalPerHour})`,
        );
      }
      throw smsUnavailable(wait);
    }

    // número de revisão: o código fixo entra pelo mesmo caminho (TTL, tentativas e trava), sem provedor nem devCode
    const code = review && this.cfg.review ? this.cfg.review.code : randomSmsCode();
    const digest = this.digest(phone, code);
    // grava ANTES do provedor: SMS que chega rápido já confere; se o provedor recusar, o refund apaga
    await this.redis.client.set(keys.code, digest, 'EX', CODE_TTL_S);
    const base: RequestCodeResponse = {
      sent: true,
      expiresIn: CODE_TTL_S,
      resendIn: RESEND_COOLDOWN_S,
    };
    if (review) {
      this.logger.log('código pedido pro número de revisão das lojas (sem SMS)');
      return base;
    }

    try {
      await this.provider.send({ to: phone, text: smsText(code), code });
    } catch (err) {
      // recusa explícita: devolve tudo. Incerto (timeout/rede/5xx): o SMS pode ter saído, então o código e a
      // cota ficam; só libera a espera pra pessoa poder pedir de novo
      const refused = isExplicitRefusal(err);
      if (refused) await this.refund(keys, ipk, digest, hasIp);
      else await this.releaseCooldown(keys);
      const e = err instanceof SmsSendError ? err : null;
      // nunca o telefone nem o código: driver, status, código do provedor e um pedaço do hash pro suporte
      this.logger.warn(
        `SMS não saiu (driver ${this.provider.name}, ${e ? `${e.kind}/${e.reason}` : 'erro inesperado'}` +
          `${e?.status ? `, status ${e.status}` : ''}${e?.providerCode ? `, código ${e.providerCode}` : ''}` +
          `, ${refused ? 'cota devolvida' : 'pode ter saído: cota mantida'}` +
          `, tel#${phoneHash(phone).slice(0, 10)})`,
      );
      if (e?.kind === 'invalid_number') throw phoneUnreachable();
      throw smsUnavailable();
    }
    return this.cfg.devCode ? { ...base, devCode: code } : base;
  }

  /**
   * Confere o código: true no acerto (apaga código, erros e espera); senão lança 401 code_invalid {attemptsLeft},
   * 401 code_expired (sem código guardado; não conta tentativa) ou 429 sms_locked {retryAfter}.
   */
  async verifyCode(phone: string, code: string): Promise<boolean> {
    const norm = normalizePhoneBR(phone ?? '') ?? phone;
    const keys = phoneKeys(this.cfg.keyPrefix, this.pk(norm));
    const { maxAttempts, lockS } = this.cfg.verify;
    // formato errado nunca bate (e conta como erro)
    const digest = /^\d{6}$/.test(code ?? '') ? this.digest(norm, code) : '-';
    const [status, n] = toPair(
      await this.cmd.metchSmsVerify(
        keys.lock,
        keys.code,
        keys.fails,
        keys.last,
        digest,
        maxAttempts,
        lockS,
        FAILS_WINDOW_S,
      ),
    );
    if (status === VERIFY_OK) return true;
    if (status === VERIFY_LOCKED) throw smsLocked(n);
    if (status === VERIFY_EXPIRED) throw codeExpired();
    if (status === VERIFY_INVALID) throw codeInvalid(n, lockS);
    throw codeExpired();
  }

  // ---------------------------------------------------------------------------------------------

  /** pedaço do HMAC do telefone: identifica sem guardar o número */
  private pk(phone: string): string {
    return phoneHash(phone).slice(0, 32);
  }

  private ipKey(bucket: string): string {
    return createHmac('sha256', phoneHashSecret())
      .update(`sms-ip:${bucket}`)
      .digest('hex')
      .slice(0, 32);
  }

  /** HMAC do código amarrado ao telefone: dump do Redis não devolve o código */
  private digest(phone: string, code: string): string {
    return createHmac('sha256', phoneHashSecret())
      .update(`sms-code:${phone}:${code}`)
      .digest('hex');
  }

  private async refund(
    keys: ReturnType<typeof phoneKeys>,
    ipk: ReturnType<typeof ipKeys>,
    digest: string,
    hasIp: string,
  ): Promise<void> {
    try {
      await this.cmd.metchSmsRefund(
        keys.last,
        keys.code,
        keys.hour,
        keys.day,
        ipk.hour,
        ipk.day,
        globalHourKey(this.cfg.keyPrefix),
        digest,
        hasIp,
        this.cfg.limits.globalPerHour > 0 ? '1' : '0',
      );
    } catch (err) {
      this.logger.warn(`não deu pra devolver a cota do SMS: ${(err as Error).message}`);
    }
  }

  /** envio incerto: só apaga a espera (código e cota ficam, o SMS pode ter chegado) */
  private async releaseCooldown(keys: ReturnType<typeof phoneKeys>): Promise<void> {
    try {
      await this.redis.client.del(keys.last);
    } catch (err) {
      this.logger.warn(`não deu pra liberar a espera do SMS: ${(err as Error).message}`);
    }
  }
}
