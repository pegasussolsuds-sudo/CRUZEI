import { Logger } from '@nestjs/common';

import { createSmsProvider } from './create-sms-provider';
import { LogSmsProvider } from './log.provider';
import { readSmsConfig } from './sms-config';
import { SmsSendError, type FetchLike, type SmsMessage } from './sms-provider';
import { TwilioSmsProvider } from './twilio.provider';
import { ZENVIA_URL, ZenviaSmsProvider } from './zenvia.provider';

// Drivers de SMS com fetch falso: URL, autenticação e corpo certos; erro vira SmsSendError SEM telefone nem código.

// SID falso montado em tempo de execução: o literal 'AC' + 32 hex dispara o detector de segredos do GitHub
const FAKE_TWILIO_SID = 'AC' + '0123456789abcdef'.repeat(2);

const PHONE = '+5534999991234';
const CODE = '482913';
const MSG: SmsMessage = {
  to: PHONE,
  text: `Metch: seu codigo e ${CODE}. Nao passe pra ninguem. Vale 5 min.`,
  code: CODE,
};
const TWILIO_CFG = {
  accountSid: FAKE_TWILIO_SID,
  authToken: 'token-secreto',
  from: '+15005550006',
  messagingServiceSid: null,
};

interface Call {
  url: string;
  init: RequestInit;
}
function fakeFetch(res: () => Response | Promise<Response>): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return res();
    },
  };
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function sendError(p: { send(m: SmsMessage): Promise<void> }): Promise<SmsSendError> {
  const err = await p.send(MSG).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(SmsSendError);
  return err as SmsSendError;
}

/** mensagem do erro nunca leva o telefone, o código ou o corpo cru do provedor */
function expectClean(e: SmsSendError) {
  const text = `${e.message} ${JSON.stringify(e)}`;
  expect(text).not.toContain('99999');
  expect(text).not.toContain('1234');
  expect(text).not.toContain(CODE);
  expect(text).not.toContain('token-secreto');
}

describe('Twilio', () => {
  it('POST form em Accounts/{SID}/Messages.json com Basic e To/Body/From; 201 resolve', async () => {
    const f = fakeFetch(() => json(201, { sid: 'SM1', to: PHONE }));
    await new TwilioSmsProvider(TWILIO_CFG, f.fetch, 8_000).send(MSG);
    expect(f.calls).toHaveLength(1);
    const { url, init } = f.calls[0]!;
    expect(url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${FAKE_TWILIO_SID}/Messages.json`);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from(`${TWILIO_CFG.accountSid}:token-secreto`).toString('base64')}`,
    );
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(String(init.body));
    expect(form.get('To')).toBe(PHONE);
    expect(form.get('Body')).toBe(MSG.text);
    expect(form.get('From')).toBe('+15005550006');
    expect(form.get('MessagingServiceSid')).toBeNull();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('com Messaging Service manda MessagingServiceSid no lugar do From', async () => {
    const f = fakeFetch(() => json(201, {}));
    await new TwilioSmsProvider(
      { ...TWILIO_CFG, messagingServiceSid: 'MG999' },
      f.fetch,
      8_000,
    ).send(MSG);
    const form = new URLSearchParams(String(f.calls[0]!.init.body));
    expect(form.get('MessagingServiceSid')).toBe('MG999');
    expect(form.get('From')).toBeNull();
  });

  it('400 com código de número inválido (21211, 21614) vira invalid_number, sem o corpo cru', async () => {
    for (const code of [21211, 21614]) {
      const body = {
        code,
        message: `The 'To' number ${PHONE} is not a valid phone number.`,
        status: 400,
      };
      const e = await sendError(
        new TwilioSmsProvider(TWILIO_CFG, fakeFetch(() => json(400, body)).fetch, 8_000),
      );
      expect(e).toMatchObject({
        kind: 'invalid_number',
        provider: 'twilio',
        status: 400,
        providerCode: String(code),
      });
      expectClean(e);
    }
  });

  it('401/500 e corpo que não é JSON viram falha do provedor', async () => {
    const e1 = await sendError(
      new TwilioSmsProvider(TWILIO_CFG, fakeFetch(() => json(401, { code: 20003 })).fetch, 8_000),
    );
    expect(e1).toMatchObject({ kind: 'provider', status: 401, providerCode: '20003' });
    const e2 = await sendError(
      new TwilioSmsProvider(
        TWILIO_CFG,
        fakeFetch(() => new Response('<html>oops</html>', { status: 502 })).fetch,
        8_000,
      ),
    );
    expect(e2).toMatchObject({ kind: 'provider', status: 502, providerCode: null });
  });

  it('timeout (AbortSignal) e erro de rede viram falha do provedor sem a mensagem crua', async () => {
    const slow: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    const e = await sendError(new TwilioSmsProvider(TWILIO_CFG, slow, 20));
    expect(e).toMatchObject({ kind: 'provider', reason: 'timeout', status: null });
    const down: FetchLike = async () => {
      throw new TypeError(`fetch failed to https://api.twilio.com/…/${PHONE}`);
    };
    const e2 = await sendError(new TwilioSmsProvider(TWILIO_CFG, down, 8_000));
    expect(e2).toMatchObject({ kind: 'provider', reason: 'network' });
    expectClean(e2);
  });
});

describe('Zenvia', () => {
  const cfg = { apiToken: 'token-secreto', from: 'metch' };

  it('POST JSON na API v2 com X-API-TOKEN; to sem o +; contents text', async () => {
    const f = fakeFetch(() => json(200, { id: 'abc' }));
    await new ZenviaSmsProvider(cfg, f.fetch, 8_000).send(MSG);
    const { url, init } = f.calls[0]!;
    expect(url).toBe(ZENVIA_URL);
    expect(url).toBe('https://api.zenvia.com/v2/channels/sms/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-API-TOKEN']).toBe('token-secreto');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({
      from: 'metch',
      to: '5534999991234',
      contents: [{ type: 'text', text: MSG.text }],
    });
  });

  it("4xx apontando o campo 'to' vira invalid_number; o resto é falha do provedor", async () => {
    const bad = {
      code: 'VALIDATION_ERROR',
      message: `to ${PHONE} inválido`,
      details: [{ path: 'to', code: 'INVALID' }],
    };
    const e = await sendError(
      new ZenviaSmsProvider(cfg, fakeFetch(() => json(400, bad)).fetch, 8_000),
    );
    expect(e).toMatchObject({
      kind: 'invalid_number',
      provider: 'zenvia',
      status: 400,
      providerCode: 'VALIDATION_ERROR',
    });
    expectClean(e);

    const auth = await sendError(
      new ZenviaSmsProvider(cfg, fakeFetch(() => json(401, { code: 'UNAUTHORIZED' })).fetch, 8_000),
    );
    expect(auth).toMatchObject({ kind: 'provider', status: 401, providerCode: 'UNAUTHORIZED' });
    const other = { code: 'VALIDATION_ERROR', details: [{ path: 'contents.0.text' }] };
    const e3 = await sendError(
      new ZenviaSmsProvider(cfg, fakeFetch(() => json(400, other)).fetch, 8_000),
    );
    expect(e3.kind).toBe('provider');
    const e4 = await sendError(
      new ZenviaSmsProvider(cfg, fakeFetch(() => json(503, {})).fetch, 8_000),
    );
    expect(e4).toMatchObject({ kind: 'provider', status: 503 });
  });
});

describe('log', () => {
  it('sem atalho: telefone mascarado e o código nunca aparece', async () => {
    const logger = { log: jest.fn() } as unknown as Logger;
    await new LogSmsProvider({ showCode: false, showPhone: true }, logger).send(MSG);
    const line = String((logger.log as jest.Mock).mock.calls[0][0]);
    expect(line).toContain('+55 34 9••••-1234');
    expect(line).not.toContain(CODE);
    expect(line).not.toContain('999991234');
  });

  it('com atalho de dev o código aparece; sem showPhone o número some', async () => {
    const logger = { log: jest.fn() } as unknown as Logger;
    await new LogSmsProvider({ showCode: true, showPhone: false }, logger).send(MSG);
    const line = String((logger.log as jest.Mock).mock.calls[0][0]);
    expect(line).toContain(CODE);
    expect(line).not.toContain('1234');
  });
});

describe('createSmsProvider', () => {
  it('escolhe pelo SMS_DRIVER', () => {
    const noFetch: FetchLike = async () => json(201, {});
    expect(createSmsProvider(readSmsConfig({ NODE_ENV: 'development' }), noFetch).name).toBe('log');
    const tw = readSmsConfig({
      NODE_ENV: 'production',
      SMS_DRIVER: 'twilio',
      TWILIO_ACCOUNT_SID: 'AC1',
      TWILIO_AUTH_TOKEN: 't',
      TWILIO_FROM: '+15005550006',
    });
    expect(createSmsProvider(tw, noFetch)).toBeInstanceOf(TwilioSmsProvider);
    const zv = readSmsConfig({
      NODE_ENV: 'production',
      SMS_DRIVER: 'zenvia',
      ZENVIA_API_TOKEN: 't',
      ZENVIA_FROM: 'm',
    });
    expect(createSmsProvider(zv, noFetch)).toBeInstanceOf(ZenviaSmsProvider);
  });
});
