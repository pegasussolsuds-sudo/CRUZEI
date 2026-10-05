import { randomBytes } from 'node:crypto';

import { Logger } from '@nestjs/common';

import { missingLegalEnv } from '../modules/legal/legal.service';

import { configuration, validateEnv } from './configuration';
import { DEV_LOCATION_SALT, EXAMPLE_JWT_SECRET } from './security';

// validateEnv: cada regra da produção "falha fechada" (NODE_ENV obrigatório, atalhos de dev, segredos, origens, banco)

type Env = Record<string, string | undefined>;

const secret = () => randomBytes(32).toString('hex');

/** dev mínimo: o que o boot exige fora de produção */
const devEnv = (extra: Env = {}): Env => ({
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://cruzei:cruzei_dev@localhost:5432/cruzei',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'curto-no-dev',
  ...extra,
});

/**
 * produção completa e válida. Traz também os valores de produção de outras áreas (SMS e armazenamento de fotos) pra
 * este teste não quebrar quando elas apertarem as regras delas — se aparecer requisito novo de produção, some aqui.
 */
const prodEnv = (extra: Env = {}): Env => {
  const legal = Object.fromEntries(missingLegalEnv({}).map((k) => [k, `valor de ${k}`]));
  return {
    ...legal,
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://metch:s3nh4-f0rt3-do-banco@db.interno:5432/metch',
    REDIS_URL: 'redis://redis.interno:6379',
    JWT_SECRET: secret(),
    LOCATION_SALT: secret(),
    PHONE_HASH_SECRET: secret(),
    PHOTO_MODERATION: 'manual',
    TRUST_PROXY_HOPS: '1',
    SMS_DRIVER: 'twilio',
    TWILIO_ACCOUNT_SID: `AC${randomBytes(16).toString('hex')}`,
    TWILIO_AUTH_TOKEN: randomBytes(16).toString('hex'),
    TWILIO_FROM: '+15005550006',
    STORAGE_PUBLIC_BASE_URL: 'https://fotos.metch.app',
    ...extra,
  };
};

const run = (env: Env) => validateEnv(env as Record<string, unknown>);

/** mensagem do erro (ou '' se não lançou) */
const errorOf = (env: Env): string => {
  try {
    run(env);
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};

let warn: jest.SpyInstance;
beforeEach(() => {
  warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const warned = (re: RegExp) => warn.mock.calls.some((c) => re.test(String(c[0])));

describe('validateEnv — NODE_ENV obrigatório', () => {
  it('ausente, vazio ou só espaço: recusa com mensagem clara', () => {
    for (const v of [undefined, '', '   ']) {
      expect(() => run(devEnv({ NODE_ENV: v }))).toThrow(/NODE_ENV ausente/);
    }
  });

  it("valor fora de development|test|production ('prod', 'staging', 'Production') recusa", () => {
    for (const v of ['prod', 'staging', 'Production']) {
      expect(() => run(devEnv({ NODE_ENV: v }))).toThrow(/NODE_ENV/);
    }
  });

  it('development mínimo sobe (JWT curto ok no dev) e devolve o NODE_ENV recebido, sem inventar atalho', () => {
    const out = run(devEnv());
    expect(out.NODE_ENV).toBe('development');
    expect(out.DEV_SHORTCUTS).toBeUndefined();
    expect(out.ALLOW_DEV_RECEIPTS).toBeUndefined();
    expect(warned(/LOCATION_SALT ausente/)).toBe(true);
  });

  it('test mínimo sobe', () => {
    expect(run(devEnv({ NODE_ENV: 'test' })).NODE_ENV).toBe('test');
  });
});

describe('validateEnv — DEV_SHORTCUTS e ALLOW_DEV_RECEIPTS', () => {
  it('development + DEV_SHORTCUTS=true sobe (com aviso)', () => {
    expect(run(devEnv({ DEV_SHORTCUTS: 'true' })).DEV_SHORTCUTS).toBe('true');
    expect(warned(/DEV_SHORTCUTS=true/)).toBe(true);
  });

  it('DEV_SHORTCUTS=true com test ou production recusa', () => {
    expect(() => run(devEnv({ NODE_ENV: 'test', DEV_SHORTCUTS: 'true' }))).toThrow(/DEV_SHORTCUTS/);
    expect(() => run(prodEnv({ DEV_SHORTCUTS: 'true' }))).toThrow(/DEV_SHORTCUTS/);
  });

  it('DEV_SHORTCUTS=false em qualquer ambiente e vazio contam como desligado', () => {
    expect(() => run(prodEnv({ DEV_SHORTCUTS: 'false' }))).not.toThrow();
    expect(() => run(devEnv({ NODE_ENV: 'test', DEV_SHORTCUTS: '' }))).not.toThrow();
    expect(() => run(devEnv({ ALLOW_DEV_RECEIPTS: '' }))).not.toThrow();
  });

  it("valor ambíguo ('1', 'yes', 'TRUE') derruba o boot", () => {
    expect(() => run(devEnv({ DEV_SHORTCUTS: '1' }))).toThrow(/DEV_SHORTCUTS/);
    expect(() => run(devEnv({ DEV_SHORTCUTS: 'TRUE' }))).toThrow(/DEV_SHORTCUTS/);
    expect(() => run(devEnv({ ALLOW_DEV_RECEIPTS: 'yes' }))).toThrow(/ALLOW_DEV_RECEIPTS/);
    expect(() => run(prodEnv({ ALLOW_DEV_RECEIPTS: '1' }))).toThrow(/ALLOW_DEV_RECEIPTS/);
  });

  it('produção com ALLOW_DEV_RECEIPTS=true sobe (beta fechado) e avisa', () => {
    expect(() => run(prodEnv({ ALLOW_DEV_RECEIPTS: 'true' }))).not.toThrow();
    expect(warned(/ALLOW_DEV_RECEIPTS=true em produção/)).toBe(true);
  });
});

describe('validateEnv — produção', () => {
  it('config completa e válida sobe, sem aviso de recibo nem de proxy', () => {
    expect(() => run(prodEnv())).not.toThrow();
    expect(warned(/ALLOW_DEV_RECEIPTS/)).toBe(false);
    expect(warned(/TRUST_PROXY_HOPS/)).toBe(false);
    expect(warned(/LOCATION_SALT/)).toBe(false);
  });

  it('TRUST_PROXY_HOPS ausente ou 0 só avisa', () => {
    expect(() => run(prodEnv({ TRUST_PROXY_HOPS: undefined }))).not.toThrow();
    expect(warned(/TRUST_PROXY_HOPS/)).toBe(true);
    warn.mockClear();
    expect(() => run(prodEnv({ TRUST_PROXY_HOPS: '0' }))).not.toThrow();
    expect(warned(/TRUST_PROXY_HOPS/)).toBe(true);
  });

  it('travas antigas continuam: PHOTO_MODERATION=off e dados legais', () => {
    expect(errorOf(prodEnv({ PHOTO_MODERATION: 'off' }))).toMatch(/PHOTO_MODERATION=off/);
    const [firstLegal] = missingLegalEnv({});
    if (firstLegal) expect(errorOf(prodEnv({ [firstLegal]: '' }))).toMatch(/dados legais ausentes/);
  });

  it('JWT_SECRET vazio, com 31 caracteres, de exemplo ou sem variedade recusa', () => {
    expect(errorOf(prodEnv({ JWT_SECRET: '' }))).toMatch(/JWT_SECRET ausente/);
    expect(errorOf(prodEnv({ JWT_SECRET: secret().slice(0, 31) }))).toMatch(/JWT_SECRET curto/);
    expect(errorOf(prodEnv({ JWT_SECRET: EXAMPLE_JWT_SECRET }))).toMatch(
      /JWT_SECRET é valor de exemplo/,
    );
    expect(errorOf(prodEnv({ JWT_SECRET: 'a'.repeat(32) }))).toMatch(
      /JWT_SECRET com pouca variedade/,
    );
  });

  it('LOCATION_SALT ausente ou de dev recusa (deixa de ser opcional em produção)', () => {
    expect(errorOf(prodEnv({ LOCATION_SALT: undefined }))).toMatch(/LOCATION_SALT ausente/);
    expect(errorOf(prodEnv({ LOCATION_SALT: DEV_LOCATION_SALT }))).toMatch(
      /LOCATION_SALT é valor de exemplo/,
    );
  });

  it('PHONE_HASH_SECRET ausente ou curto recusa', () => {
    expect(errorOf(prodEnv({ PHONE_HASH_SECRET: undefined }))).toMatch(/PHONE_HASH_SECRET ausente/);
    expect(errorOf(prodEnv({ PHONE_HASH_SECRET: 'abc123' }))).toMatch(/PHONE_HASH_SECRET curto/);
  });

  it('segredo repetido recusa', () => {
    const s = secret();
    expect(errorOf(prodEnv({ JWT_SECRET: s, PHONE_HASH_SECRET: s }))).toMatch(
      /JWT_SECRET e PHONE_HASH_SECRET iguais/,
    );
    expect(errorOf(prodEnv({ LOCATION_SALT: s, PHONE_HASH_SECRET: ` ${s} ` }))).toMatch(
      /LOCATION_SALT e PHONE_HASH_SECRET iguais/,
    );
  });

  it("ALLOWED_ORIGINS com '*', http, path ou lixo recusa", () => {
    for (const bad of ['*', 'http://admin.metch.app', 'https://a.com/x', 'foo']) {
      expect(errorOf(prodEnv({ ALLOWED_ORIGINS: bad }))).toMatch(/ALLOWED_ORIGINS/);
    }
  });

  it('senha de exemplo (cruzei_dev) no DATABASE_URL recusa', () => {
    expect(
      errorOf(
        prodEnv({ DATABASE_URL: 'postgresql://cruzei:cruzei_dev@db:5432/cruzei?schema=public' }),
      ),
    ).toMatch(/DATABASE_URL usa a senha de exemplo/);
  });

  it('vários problemas saem numa mensagem só, e nenhum valor de segredo aparece', () => {
    const jwt = 'segredo-jwt-curto-9f8e7d';
    const phone = 'hash-curto-1a2b3c';
    const msg = errorOf(
      prodEnv({
        JWT_SECRET: jwt,
        LOCATION_SALT: undefined,
        PHONE_HASH_SECRET: phone,
        ALLOWED_ORIGINS: 'http://admin.metch.app',
        DATABASE_URL: 'postgresql://cruzei:cruzei_dev@db:5432/cruzei',
      }),
    );
    expect(msg).toMatch(/^Config de produção insegura: /);
    for (const re of [
      /JWT_SECRET curto/,
      /LOCATION_SALT ausente/,
      /PHONE_HASH_SECRET curto/,
      /ALLOWED_ORIGINS/,
      /senha de exemplo/,
    ])
      expect(msg).toMatch(re);
    expect(msg.split('; ').length).toBeGreaterThanOrEqual(5);
    for (const v of [jwt, phone, 'cruzei_dev@']) expect(msg).not.toContain(v);
  });

  it('storage das fotos: produção sem base https ou s3 sem chave recusa, sem ecoar segredo', () => {
    expect(errorOf(prodEnv({ STORAGE_PUBLIC_BASE_URL: undefined }))).toMatch(
      /STORAGE_PUBLIC_BASE_URL é obrigatória em produção/,
    );
    expect(errorOf(prodEnv({ STORAGE_PUBLIC_BASE_URL: 'http://fotos.metch.app' }))).toMatch(
      /precisa ser https/,
    );
    const secretKey = 'chave-secreta-do-bucket-123';
    const msg = errorOf(prodEnv({ STORAGE_DRIVER: 's3', STORAGE_S3_SECRET_ACCESS_KEY: secretKey }));
    expect(msg).toMatch(/STORAGE_S3_ENDPOINT ausente/);
    expect(msg).not.toContain(secretKey);
    expect(errorOf(devEnv({ STORAGE_DRIVER: 'ftp' }))).toMatch(
      /STORAGE_DRIVER precisa ser local ou s3/,
    );
    expect(errorOf(devEnv())).toBe('');
  });
});

describe('configuration() — ambiente e origens', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("produção: 'https://Admin.Metch.app/' é aceito e sai normalizado", () => {
    const env = prodEnv({ ALLOWED_ORIGINS: 'https://Admin.Metch.app/' });
    expect(() => run(env)).not.toThrow();
    process.env = { ...env } as NodeJS.ProcessEnv;
    const c = configuration();
    expect(c.env).toBe('production');
    expect(c.corsOrigins).toEqual(['https://admin.metch.app']);
  });

  it('produção só com CORS_ORIGINS (nome legado) usa o legado — e valida com o nome dele', () => {
    const env = prodEnv({ CORS_ORIGINS: 'https://admin.metch.app' });
    expect(() => run(env)).not.toThrow();
    process.env = { ...env } as NodeJS.ProcessEnv;
    expect(configuration().corsOrigins).toEqual(['https://admin.metch.app']);
    expect(errorOf(prodEnv({ CORS_ORIGINS: 'http://admin.metch.app' }))).toMatch(
      /CORS_ORIGINS só aceita https/,
    );
  });

  it('produção sem origem nenhuma: lista vazia (nada de localhost)', () => {
    process.env = { ...prodEnv() } as NodeJS.ProcessEnv;
    expect(configuration().corsOrigins).toEqual([]);
  });

  it('sem NODE_ENV, configuration() diz production (nunca development)', () => {
    process.env = { ...devEnv({ NODE_ENV: undefined }) } as NodeJS.ProcessEnv;
    delete process.env.NODE_ENV;
    expect(configuration().env).toBe('production');
    expect(configuration().corsOrigins).toEqual([]);
  });

  it('dev sem nada: localhost do Expo, como antes; entrada inválida no dev só avisa', () => {
    process.env = { ...devEnv() } as NodeJS.ProcessEnv;
    delete process.env.ALLOWED_ORIGINS;
    delete process.env.CORS_ORIGINS;
    expect(configuration().env).toBe('development');
    expect(configuration().corsOrigins).toEqual([
      'http://localhost:8081',
      'http://localhost:19006',
    ]);
    expect(() => run(devEnv({ ALLOWED_ORIGINS: '*,http://localhost:5173' }))).not.toThrow();
    expect(warned(/ALLOWED_ORIGINS com entrada ignorada/)).toBe(true);
  });
});
