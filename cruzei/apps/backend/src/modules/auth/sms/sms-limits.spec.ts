import { HttpException } from '@nestjs/common';

import {
  codeInvalid,
  retryAfterOf,
  smsCooldown,
  smsLocked,
  smsRateLimited,
  smsUnavailable,
  withRetryAfter,
} from './sms-errors';
import { humanWait, ipBucket, ipKeys, phoneKeys } from './sms-limits';

// Peças puras do SMS: balde do IP, espera legível e corpos de erro do contrato.

describe('ipBucket', () => {
  it('IPv4 como está; IPv4 mapeado em IPv6 vira IPv4', () => {
    expect(ipBucket('200.10.20.30')).toBe('200.10.20.30');
    expect(ipBucket('::ffff:200.10.20.30')).toBe('200.10.20.30');
    expect(ipBucket('::FFFF:127.0.0.1')).toBe('127.0.0.1');
  });

  it('IPv6 agrupado por /64 (mesmo aparelho trocando o final divide a cota)', () => {
    const a = ipBucket('2804:14c:5b80:9e01:1111:2222:3333:4444');
    const b = ipBucket('2804:14c:5b80:9e01::abcd');
    expect(a).toBe('2804:014c:5b80:9e01::/64');
    expect(b).toBe(a);
    expect(ipBucket('2804:14c:5b80:9e02::1')).not.toBe(a);
    expect(ipBucket('::1')).toBe('0000:0000:0000:0000::/64');
    expect(ipBucket('fe80::1%eth0')).toBe('fe80:0000:0000:0000::/64');
  });

  it('vazio ou lixo = sem balde (o teto por IP não se aplica)', () => {
    expect(ipBucket(null)).toBeNull();
    expect(ipBucket(undefined)).toBeNull();
    expect(ipBucket('')).toBeNull();
    expect(ipBucket('não é ip')).toBeNull();
  });
});

describe('chaves', () => {
  it('prefixo + hash; sem IP a chave existe mas não é de ninguém', () => {
    expect(phoneKeys('sms', 'abc')).toEqual({
      code: 'sms:c:abc',
      last: 'sms:last:abc',
      fails: 'sms:f:abc',
      lock: 'sms:lock:abc',
      hour: 'sms:n:h:abc',
      day: 'sms:n:d:abc',
    });
    expect(ipKeys('sms', null)).toEqual({ hour: 'sms:ip:h:none', day: 'sms:ip:d:none' });
  });
});

describe('humanWait', () => {
  it('segundos, minutos (pra cima) e horas', () => {
    expect(humanWait(30)).toBe('30 s');
    expect(humanWait(0)).toBe('1 s');
    expect(humanWait(61)).toBe('2 min');
    expect(humanWait(900)).toBe('15 min');
    expect(humanWait(2_520)).toBe('42 min');
    expect(humanWait(3_600)).toBe('1 h');
    expect(humanWait(5_400)).toBe('1 h 30 min');
    expect(humanWait(86_399)).toBe('24 h');
  });
});

const bodyOf = (e: HttpException) => e.getResponse() as Record<string, unknown>;

describe('erros do contrato', () => {
  it("cooldown mantém o 'Ns' (regex do painel e do app antigo) e o retryAfter", () => {
    const e = smsCooldown(23);
    expect(e.getStatus()).toBe(429);
    expect(bodyOf(e)).toEqual({
      error: 'sms_cooldown',
      message: 'Aguarde 23s antes de pedir outro código',
      retryAfter: 23,
    });
    expect(/(\d+)\s*s/.exec(String(bodyOf(e).message))?.[1]).toBe('23');
  });

  it('teto por número e por conexão, com scope e espera legível', () => {
    expect(bodyOf(smsRateLimited('phone', 2_520))).toEqual({
      error: 'sms_rate_limited',
      scope: 'phone',
      retryAfter: 2_520,
      message: 'Esse número já pediu códigos demais. Tenta de novo em 42 min.',
    });
    expect(bodyOf(smsRateLimited('ip', 3_600)).message).toBe(
      'Muitos códigos pedidos desta conexão. Tenta de novo em 1 h.',
    );
  });

  it('trava, código errado (última tentativa) e indisponível', () => {
    expect(bodyOf(smsLocked(900)).message).toBe(
      'Muitas tentativas erradas. Por segurança, espera 15 min e pede um código novo.',
    );
    expect(bodyOf(codeInvalid(3, 900))).toEqual({
      error: 'code_invalid',
      message: 'Código errado. Restam 3 tentativas.',
      attemptsLeft: 3,
    });
    expect(bodyOf(codeInvalid(1, 900)).message).toBe(
      'Código errado. Última tentativa antes de uma pausa de 15 min.',
    );
    expect(codeInvalid(1, 900).getStatus()).toBe(401);
    expect(smsUnavailable().getStatus()).toBe(503);
    expect(bodyOf(smsUnavailable())).not.toHaveProperty('retryAfter');
  });

  it('withRetryAfter põe o header só quando o erro tem espera', async () => {
    const res = { setHeader: jest.fn() };
    await expect(
      withRetryAfter(res, async () => Promise.reject(smsLocked(899.2))),
    ).rejects.toBeInstanceOf(HttpException);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '900');
    res.setHeader.mockClear();
    await expect(
      withRetryAfter(res, async () => Promise.reject(codeInvalid(2, 900))),
    ).rejects.toBeTruthy();
    await expect(withRetryAfter(res, async () => 'ok')).resolves.toBe('ok');
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(retryAfterOf(new Error('x'))).toBeNull();
  });
});
