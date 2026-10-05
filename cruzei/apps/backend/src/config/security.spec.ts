import {
  DEV_LOCATION_SALT,
  DEV_PHONE_HASH_SECRET,
  EXAMPLE_JWT_SECRET,
  appEnv,
  databaseUsesExamplePassword,
  devShortcutsEnabled,
  isProduction,
  originAllowed,
  parseOrigins,
  productionProblems,
  repeatedSecrets,
  resolveAllowedOrigins,
  secretProblems,
} from './security';

const STRONG = 'k7Q2vX9pL4mN8rT1wZ6yB3cF5hJ0dG2s'; // 32, variado

describe('appEnv / isProduction', () => {
  it('ausente, vazio, desconhecido ou com caixa/espaço estranho vira production', () => {
    for (const v of [undefined, '', '  ', 'prod', 'staging', 'PRODUCTION ', 'dev']) {
      expect(appEnv({ NODE_ENV: v })).toBe('production');
      expect(isProduction({ NODE_ENV: v })).toBe(true);
    }
    expect(appEnv({})).toBe('production');
  });

  it('development e test (com trim/caixa) ficam como estão', () => {
    expect(appEnv({ NODE_ENV: ' development ' })).toBe('development');
    expect(appEnv({ NODE_ENV: 'Development' })).toBe('development');
    expect(appEnv({ NODE_ENV: 'test' })).toBe('test');
    expect(isProduction({ NODE_ENV: 'test' })).toBe(false);
  });
});

describe('devShortcutsEnabled', () => {
  it('só development + DEV_SHORTCUTS=true', () => {
    expect(devShortcutsEnabled({ NODE_ENV: 'development', DEV_SHORTCUTS: 'true' })).toBe(true);
    expect(devShortcutsEnabled({ NODE_ENV: 'development', DEV_SHORTCUTS: ' true ' })).toBe(true);
    expect(devShortcutsEnabled({ NODE_ENV: 'development' })).toBe(false);
    expect(devShortcutsEnabled({ NODE_ENV: 'development', DEV_SHORTCUTS: 'false' })).toBe(false);
    expect(devShortcutsEnabled({ NODE_ENV: 'development', DEV_SHORTCUTS: '1' })).toBe(false);
    expect(devShortcutsEnabled({ NODE_ENV: 'test', DEV_SHORTCUTS: 'true' })).toBe(false);
    expect(devShortcutsEnabled({ NODE_ENV: 'production', DEV_SHORTCUTS: 'true' })).toBe(false);
    expect(devShortcutsEnabled({ DEV_SHORTCUTS: 'true' })).toBe(false);
  });
});

describe('secretProblems', () => {
  it('forte passa', () => {
    expect(secretProblems('JWT_SECRET', STRONG)).toEqual([]);
  });

  it('ausente, vazio, curto, exemplo/dev, placeholder e pouca variedade', () => {
    expect(secretProblems('X', undefined)).toEqual(['X ausente']);
    expect(secretProblems('X', '   ')).toEqual(['X ausente']);
    expect(secretProblems('X', STRONG.slice(0, 31)).join()).toMatch(/curto/);
    for (const weak of [EXAMPLE_JWT_SECRET, DEV_PHONE_HASH_SECRET, DEV_LOCATION_SALT])
      expect(secretProblems('X', weak).join()).toMatch(/exemplo/);
    expect(secretProblems('X', `change-me-${STRONG}`).join()).toMatch(/placeholder/);
    expect(secretProblems('X', 'a'.repeat(40)).join()).toMatch(/variedade/);
    expect(secretProblems('X', '12341234123412341234123412341234').join()).toMatch(/variedade/);
  });

  it('nunca devolve o valor', () => {
    const v = 'segredo-curto-xyz';
    for (const msg of secretProblems('JWT_SECRET', v)) expect(msg).not.toContain(v);
  });
});

describe('repeatedSecrets', () => {
  it('aponta os nomes repetidos, ignora ausentes', () => {
    expect(
      repeatedSecrets({
        JWT_SECRET: STRONG,
        LOCATION_SALT: `${STRONG}x`,
        PHONE_HASH_SECRET: STRONG,
      }),
    ).toEqual(['JWT_SECRET e PHONE_HASH_SECRET']);
    expect(repeatedSecrets({ JWT_SECRET: STRONG })).toEqual([]);
  });
});

describe('parseOrigins / resolveAllowedOrigins', () => {
  it('normaliza (barra final, caixa) e recusa curinga, null, path, query, credencial e lixo', () => {
    const { origins, invalid } = parseOrigins(
      ' https://Admin.Metch.app/ , http://localhost:5173,*,null,https://a.com/x,https://a.com?q=1,foo,https://*.metch.app,https://u:p@a.com,ftp://a.com,https://admin.metch.app',
    );
    expect(origins).toEqual(['https://admin.metch.app', 'http://localhost:5173']);
    expect(invalid).toEqual([
      '*',
      'null',
      'https://a.com/x',
      'https://a.com?q=1',
      'foo',
      'https://*.metch.app',
      'https://u:p@a.com',
      'ftp://a.com',
    ]);
  });

  it('ALLOWED_ORIGINS vence; CORS_ORIGINS é alias; defaults só fora de produção', () => {
    expect(
      resolveAllowedOrigins({
        NODE_ENV: 'production',
        ALLOWED_ORIGINS: 'https://a.metch.app',
        CORS_ORIGINS: 'https://b.metch.app',
      }),
    ).toEqual(['https://a.metch.app']);
    expect(
      resolveAllowedOrigins({ NODE_ENV: 'production', CORS_ORIGINS: 'https://b.metch.app' }),
    ).toEqual(['https://b.metch.app']);
    expect(resolveAllowedOrigins({ NODE_ENV: 'production' })).toEqual([]);
    expect(resolveAllowedOrigins({})).toEqual([]);
    expect(resolveAllowedOrigins({ NODE_ENV: 'development' })).toEqual([
      'http://localhost:8081',
      'http://localhost:19006',
    ]);
    expect(resolveAllowedOrigins({ NODE_ENV: 'test', ALLOWED_ORIGINS: '*' })).toEqual([
      'http://localhost:8081',
      'http://localhost:19006',
    ]);
  });
});

describe('originAllowed (socket)', () => {
  const list = new Set(['https://admin.metch.app']);

  it('sem Origin (nativo) passa; na lista passa, com barra final ou caixa', () => {
    expect(originAllowed(undefined, list, ['api.metch.app'])).toBe(true);
    expect(originAllowed('', list, ['api.metch.app'])).toBe(true);
    expect(originAllowed('https://admin.metch.app', list, ['api.metch.app'])).toBe(true);
    expect(originAllowed('https://Admin.Metch.App/', list, ['api.metch.app'])).toBe(true);
  });

  it("outra origem e 'null' não passam", () => {
    expect(originAllowed('https://evil.x', list, ['api.metch.app'])).toBe(false);
    expect(originAllowed('null', list, ['api.metch.app'])).toBe(false);
    expect(originAllowed('lixo', list, ['api.metch.app'])).toBe(false);
    expect(originAllowed('http://admin.metch.app', list, ['api.metch.app'])).toBe(false);
  });

  it('Origin igual ao host da requisição (RN manda a URL do servidor) passa, inclusive via X-Forwarded-Host', () => {
    expect(originAllowed('https://api.metch.app', list, ['api.metch.app'])).toBe(true);
    expect(originAllowed('https://api.metch.app', list, ['API.metch.app'])).toBe(true);
    expect(originAllowed('http://127.0.0.1:3000', list, ['127.0.0.1:3000'])).toBe(true);
    expect(originAllowed('http://127.0.0.1:3000', list, ['127.0.0.1:3001'])).toBe(false);
    expect(originAllowed('https://api.metch.app', list, ['backend:3000', 'api.metch.app'])).toBe(
      true,
    );
    expect(
      originAllowed('https://api.metch.app', list, ['backend:3000', 'x.y, api.metch.app']),
    ).toBe(true);
    expect(originAllowed('https://api.metch.app', list, [undefined, undefined])).toBe(false);
  });
});

describe('productionProblems', () => {
  const ok = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://metch:s3nh4-f0rt3@db:5432/metch',
    JWT_SECRET: STRONG,
    LOCATION_SALT: `L${STRONG}`,
    PHONE_HASH_SECRET: `P${STRONG}`,
  };

  it('config boa: nenhum problema', () => {
    expect(productionProblems(ok)).toEqual([]);
    expect(productionProblems({ ...ok, ALLOWED_ORIGINS: 'https://admin.metch.app' })).toEqual([]);
  });

  it('origem http, curinga e senha de exemplo do banco', () => {
    const p = productionProblems({
      ...ok,
      ALLOWED_ORIGINS: 'http://admin.metch.app,*',
      DATABASE_URL: 'postgresql://cruzei:cruzei_dev@localhost:5432/cruzei',
    });
    expect(p.join('\n')).toMatch(/ALLOWED_ORIGINS com entrada inválida.*\*/);
    expect(p.join('\n')).toMatch(/ALLOWED_ORIGINS só aceita https/);
    expect(p.join('\n')).toMatch(/senha de exemplo/);
  });

  it('senha de exemplo detectada com codificação na URL; URL inválida não quebra', () => {
    expect(databaseUsesExamplePassword('postgresql://u:cruzei%5Fdev@h/db')).toBe(true);
    expect(databaseUsesExamplePassword('postgresql://u:outra@h/db')).toBe(false);
    expect(databaseUsesExamplePassword('não é url')).toBe(false);
    expect(databaseUsesExamplePassword(undefined)).toBe(false);
  });
});
