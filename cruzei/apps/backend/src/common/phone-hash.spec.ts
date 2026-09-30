import { phoneHash, phoneHashSecret } from './phone-hash';

describe('phoneHash (teste grátis por número)', () => {
  it('HMAC-SHA256 em hex (64), nunca o número', () => {
    const h = phoneHash('+5534999990000', 's1');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain('34999990000');
  });

  it('o mesmo número em formatos diferentes dá a mesma marca', () => {
    const a = phoneHash('+55 (34) 99999-0000', 's1');
    expect(phoneHash('34999990000', 's1')).toBe(a);
    expect(phoneHash('5534999990000', 's1')).toBe(a);
    expect(phoneHash('+5534999990000', 's1')).toBe(a);
  });

  it('número diferente ou segredo diferente → marca diferente', () => {
    expect(phoneHash('+5534999990001', 's1')).not.toBe(phoneHash('+5534999990000', 's1'));
    expect(phoneHash('+5534999990000', 's2')).not.toBe(phoneHash('+5534999990000', 's1'));
  });

  it('segredo: env; produção sem segredo falha; dev cai no padrão', () => {
    expect(phoneHashSecret({ PHONE_HASH_SECRET: ' abc ' } as NodeJS.ProcessEnv)).toBe('abc');
    expect(() => phoneHashSecret({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(
      'PHONE_HASH_SECRET',
    );
    expect(phoneHashSecret({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toEqual(
      expect.any(String),
    );
  });
});
