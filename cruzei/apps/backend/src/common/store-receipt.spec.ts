import { HttpException } from '@nestjs/common';

import { assertStoreReceipt, devReceiptsAllowed } from './store-receipt';

const status = (
  fn: () => void,
): { status: number; body: { error?: string; message?: string } } | null => {
  try {
    fn();
    return null;
  } catch (e) {
    const h = e as HttpException;
    return { status: h.getStatus(), body: h.getResponse() as { error?: string; message?: string } };
  }
};

describe('recibo da loja (mesma regra da assinatura)', () => {
  it("'dev' só com atalho de dev (development + DEV_SHORTCUTS) ou ALLOW_DEV_RECEIPTS=true", () => {
    const DEV = { NODE_ENV: 'development', DEV_SHORTCUTS: 'true' };
    expect(devReceiptsAllowed(DEV)).toBe(true);
    // development sem a flag, test, sem NODE_ENV e desconhecido: não
    expect(devReceiptsAllowed({ NODE_ENV: 'development' })).toBe(false);
    expect(devReceiptsAllowed({ NODE_ENV: 'development', DEV_SHORTCUTS: 'false' })).toBe(false);
    expect(devReceiptsAllowed({ NODE_ENV: 'test' })).toBe(false);
    expect(devReceiptsAllowed({})).toBe(false);
    expect(devReceiptsAllowed({ NODE_ENV: 'staging', DEV_SHORTCUTS: 'true' })).toBe(false);
    expect(devReceiptsAllowed({ NODE_ENV: 'production' })).toBe(false);
    expect(devReceiptsAllowed({ NODE_ENV: 'production', DEV_SHORTCUTS: 'true' })).toBe(false);
    // ALLOW_DEV_RECEIPTS=true vale em qualquer ambiente (beta fechado); '1' não
    expect(devReceiptsAllowed({ NODE_ENV: 'production', ALLOW_DEV_RECEIPTS: 'true' })).toBe(true);
    expect(devReceiptsAllowed({ NODE_ENV: 'test', ALLOW_DEV_RECEIPTS: 'true' })).toBe(true);
    expect(devReceiptsAllowed({ ALLOW_DEV_RECEIPTS: 'true' })).toBe(true);
    expect(devReceiptsAllowed({ NODE_ENV: 'production', ALLOW_DEV_RECEIPTS: '1' })).toBe(false);
  });

  it('dev com atalho passa; recibo qualquer é 402', () => {
    const DEV = { NODE_ENV: 'development', DEV_SHORTCUTS: 'true' };
    expect(status(() => assertStoreReceipt('dev', 'Boost', DEV))).toBeNull();
    const r = status(() => assertStoreReceipt('abc', 'Boost', DEV));
    expect(r?.status).toBe(402);
    expect(r?.body.error).toBe('receipt_invalid');
  });

  it('produção (ou sem NODE_ENV) sem validação de loja: 402 com mensagem clara, até com "dev" ou vazio', () => {
    for (const env of [{ NODE_ENV: 'production' }, {}, { NODE_ENV: 'development' }]) {
      for (const receipt of ['dev', 'recibo-da-loja', '', undefined]) {
        const r = status(() => assertStoreReceipt(receipt, 'Boost', env));
        expect(r?.status).toBe(402);
        expect(r?.body.error).toBe('payment_unavailable');
        expect(r?.body.message).toMatch(/Boost/);
        expect(r?.body.message).toMatch(/Nada foi cobrado/);
      }
    }
    expect(
      status(() =>
        assertStoreReceipt('dev', 'Boost', { NODE_ENV: 'production', ALLOW_DEV_RECEIPTS: 'true' }),
      ),
    ).toBeNull();
  });
});
