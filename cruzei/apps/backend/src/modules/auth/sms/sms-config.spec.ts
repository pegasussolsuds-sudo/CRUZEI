import {
  isWeakCode,
  loadSmsConfig,
  readSmsConfig,
  SMS_LIMIT_DEFAULTS,
  smsEnvProblems,
} from './sms-config';

// Config do SMS: driver, credenciais, número de revisão das lojas e tetos. Problema sai só com nome e motivo.

// SID falso montado em tempo de execução: o literal 'AC' + 32 hex dispara o detector de segredos do GitHub
const FAKE_TWILIO_SID = 'AC' + '0123456789abcdef'.repeat(2);

const dev = (extra: Record<string, string> = {}) => ({ NODE_ENV: 'development', ...extra });
const prod = (extra: Record<string, string> = {}) => ({ NODE_ENV: 'production', ...extra });
const TWILIO = {
  SMS_DRIVER: 'twilio',
  TWILIO_ACCOUNT_SID: FAKE_TWILIO_SID,
  TWILIO_AUTH_TOKEN: 'token-da-twilio-secreto',
  TWILIO_FROM: '+15005550006',
};
const ZENVIA = {
  SMS_DRIVER: 'zenvia',
  ZENVIA_API_TOKEN: 'token-da-zenvia-secreto',
  ZENVIA_FROM: 'metch',
};

describe('driver', () => {
  it('sem SMS_DRIVER fora de produção é log, sem problema', () => {
    expect(smsEnvProblems(dev())).toEqual([]);
    expect(readSmsConfig(dev()).driver).toBe('log');
    expect(readSmsConfig({ NODE_ENV: 'test' }).driver).toBe('log');
  });

  it('produção exige twilio ou zenvia: vazio, log ou sem NODE_ENV não sobe', () => {
    expect(smsEnvProblems(prod())).toEqual([
      expect.stringMatching(/SMS_DRIVER ausente em produção/),
    ]);
    expect(smsEnvProblems(prod({ SMS_DRIVER: 'log' }))).toEqual([
      expect.stringMatching(/SMS_DRIVER=log em produção/),
    ]);
    // ambiente ausente conta como produção
    expect(smsEnvProblems({})).toEqual([expect.stringMatching(/SMS_DRIVER ausente/)]);
    expect(() => loadSmsConfig(prod())).toThrow(/Config de SMS inválida/);
    expect(smsEnvProblems(prod(TWILIO))).toEqual([]);
    expect(smsEnvProblems(prod(ZENVIA))).toEqual([]);
  });

  it('driver desconhecido é problema em qualquer ambiente (sem ecoar o valor)', () => {
    const p = smsEnvProblems(dev({ SMS_DRIVER: 'firebase-segredo' }));
    expect(p).toEqual([expect.stringMatching(/SMS_DRIVER inválido/)]);
    expect(p.join()).not.toContain('firebase-segredo');
    expect(
      readSmsConfig(dev({ SMS_DRIVER: ' Twilio ', ...{ TWILIO_ACCOUNT_SID: 'x' } })).driver,
    ).toBe('twilio');
  });
});

describe('credenciais', () => {
  it('twilio: SID, TOKEN e FROM ou Messaging Service', () => {
    const without = (k: keyof typeof TWILIO) =>
      Object.fromEntries(Object.entries(TWILIO).filter(([n]) => n !== k));
    const noSid = without('TWILIO_ACCOUNT_SID');
    const noToken = without('TWILIO_AUTH_TOKEN');
    const noFrom = without('TWILIO_FROM');
    expect(smsEnvProblems(dev(noSid))).toEqual(['TWILIO_ACCOUNT_SID ausente']);
    expect(smsEnvProblems(dev(noToken))).toEqual(['TWILIO_AUTH_TOKEN ausente']);
    expect(smsEnvProblems(dev(noFrom))).toEqual([
      'TWILIO_FROM ou TWILIO_MESSAGING_SERVICE_SID ausente',
    ]);
    expect(smsEnvProblems(dev({ ...noFrom, TWILIO_MESSAGING_SERVICE_SID: 'MG123' }))).toEqual([]);
    expect(smsEnvProblems(dev({ ...TWILIO, TWILIO_FROM: '11 99999-0000' }))).toEqual([
      expect.stringMatching(/E\.164/),
    ]);
  });

  it('zenvia: TOKEN e FROM', () => {
    expect(smsEnvProblems(dev({ ...ZENVIA, ZENVIA_API_TOKEN: '' }))).toEqual([
      'ZENVIA_API_TOKEN ausente',
    ]);
    expect(smsEnvProblems(dev({ ...ZENVIA, ZENVIA_FROM: ' ' }))).toEqual(['ZENVIA_FROM ausente']);
  });

  it('nenhum problema carrega o valor de segredo', () => {
    const env = prod({
      ...TWILIO,
      TWILIO_FROM: 'errado',
      REVIEW_PHONE: '34999998888',
      REVIEW_CODE: '123456',
    });
    const msg = smsEnvProblems(env).join('; ');
    for (const v of [
      TWILIO.TWILIO_AUTH_TOKEN,
      TWILIO.TWILIO_ACCOUNT_SID,
      '123456',
      '34999998888',
      'errado',
    ]) {
      expect(msg).not.toContain(v);
    }
  });

  it('config tipada leva só as credenciais do driver escolhido', () => {
    const c = readSmsConfig(dev({ ...TWILIO, ZENVIA_API_TOKEN: 'outro' }));
    expect(c.twilio).toEqual({
      accountSid: TWILIO.TWILIO_ACCOUNT_SID,
      authToken: TWILIO.TWILIO_AUTH_TOKEN,
      from: '+15005550006',
      messagingServiceSid: null,
    });
    expect(c.zenvia).toBeNull();
  });
});

describe('número de revisão das lojas', () => {
  it('sempre os dois juntos', () => {
    expect(smsEnvProblems(dev({ REVIEW_PHONE: '(34) 99999-8888' }))).toEqual([
      'REVIEW_PHONE sem REVIEW_CODE',
    ]);
    expect(smsEnvProblems(dev({ REVIEW_CODE: '482913' }))).toEqual([
      'REVIEW_CODE sem REVIEW_PHONE',
    ]);
  });

  it('telefone normalizado pra +55 e precisa ser celular', () => {
    const c = readSmsConfig(dev({ REVIEW_PHONE: '(34) 99999-8888', REVIEW_CODE: '482913' }));
    expect(c.review).toEqual({ phone: '+5534999998888', code: '482913' });
    expect(smsEnvProblems(dev({ REVIEW_PHONE: '(34) 3232-1234', REVIEW_CODE: '482913' }))).toEqual([
      'REVIEW_PHONE precisa ser celular brasileiro com DDD',
    ]);
    expect(smsEnvProblems(dev({ REVIEW_PHONE: 'abc', REVIEW_CODE: '482913' }))).toHaveLength(1);
  });

  it("código fraco ou fora do formato é recusado ('123456', '000000', '12345', 'abc123')", () => {
    for (const code of ['123456', '000000', '654321', '121212', '123123']) {
      expect(smsEnvProblems(dev({ REVIEW_PHONE: '34999998888', REVIEW_CODE: code }))).toEqual([
        expect.stringMatching(/REVIEW_CODE fácil demais/),
      ]);
    }
    for (const code of ['12345', 'abc123', '1234567']) {
      expect(smsEnvProblems(dev({ REVIEW_PHONE: '34999998888', REVIEW_CODE: code }))).toEqual([
        'REVIEW_CODE precisa ter 6 dígitos',
      ]);
    }
    // config quebrada nunca vira número de revisão pela metade
    expect(
      readSmsConfig(dev({ REVIEW_PHONE: '34999998888', REVIEW_CODE: '123456' })).review,
    ).toBeNull();
    expect(readSmsConfig(dev()).review).toBeNull();
  });

  it('isWeakCode', () => {
    for (const c of ['111111', '012345', '890123', '543210', '909090', '147258', 'x'])
      expect(isWeakCode(c)).toBe(true);
    for (const c of ['482913', '730516', '205817']) expect(isWeakCode(c)).toBe(false);
  });
});

describe('tetos e devCode', () => {
  it('padrões e valores do env; valor ruim é problema e cai no padrão', () => {
    expect(readSmsConfig(dev()).limits).toEqual(SMS_LIMIT_DEFAULTS);
    expect(readSmsConfig(dev()).verify).toEqual({ maxAttempts: 5, lockS: 900 });
    const c = readSmsConfig(
      dev({
        SMS_MAX_PER_PHONE_HOUR: '3',
        SMS_MAX_PER_HOUR_GLOBAL: '500',
        SMS_VERIFY_LOCK_S: '600',
      }),
    );
    expect(c.limits).toMatchObject({ phonePerHour: 3, globalPerHour: 500 });
    expect(c.verify.lockS).toBe(600);
    expect(smsEnvProblems(dev({ SMS_MAX_PER_IP_DAY: '0' }))).toEqual([
      expect.stringMatching(/SMS_MAX_PER_IP_DAY inválido/),
    ]);
    expect(smsEnvProblems(dev({ SMS_VERIFY_MAX_ATTEMPTS: 'cinco' }))).toHaveLength(1);
    expect(readSmsConfig(dev({ SMS_VERIFY_MAX_ATTEMPTS: 'cinco' })).verify.maxAttempts).toBe(5);
  });

  it('devCode só com driver log + NODE_ENV=development + DEV_SHORTCUTS=true', () => {
    expect(readSmsConfig(dev({ DEV_SHORTCUTS: 'true' })).devCode).toBe(true);
    expect(readSmsConfig(dev()).devCode).toBe(false);
    expect(readSmsConfig({ NODE_ENV: 'test', DEV_SHORTCUTS: 'true' }).devCode).toBe(false);
    expect(readSmsConfig({ DEV_SHORTCUTS: 'true' }).devCode).toBe(false);
    expect(readSmsConfig(prod({ DEV_SHORTCUTS: 'true', SMS_DRIVER: 'log' })).devCode).toBe(false);
    expect(readSmsConfig(dev({ ...TWILIO, DEV_SHORTCUTS: 'true' })).devCode).toBe(false);
  });

  it('telefone mascarado no log só fora de produção', () => {
    expect(readSmsConfig(dev()).logPhone).toBe(true);
    expect(readSmsConfig(prod(TWILIO)).logPhone).toBe(false);
    expect(readSmsConfig({}).logPhone).toBe(false);
  });
});
