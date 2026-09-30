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
  it("'dev' só fora de produção ou com ALLOW_DEV_RECEIPTS=true", () => {
    expect(devReceiptsAllowed({ NODE_ENV: 'development' })).toBe(true);
    expect(devReceiptsAllowed({ NODE_ENV: 'test' })).toBe(true);
    expect(devReceiptsAllowed({ NODE_ENV: 'production' })).toBe(false);
    expect(devReceiptsAllowed({ NODE_ENV: 'production', ALLOW_DEV_RECEIPTS: 'true' })).toBe(true);
    expect(devReceiptsAllowed({ NODE_ENV: 'production', ALLOW_DEV_RECEIPTS: '1' })).toBe(false);
  });

  it('dev fora de produção passa; recibo qualquer é 402', () => {
    expect(
      status(() => assertStoreReceipt('dev', 'Boost', { NODE_ENV: 'development' })),
    ).toBeNull();
    const r = status(() => assertStoreReceipt('abc', 'Boost', { NODE_ENV: 'development' }));
    expect(r?.status).toBe(402);
    expect(r?.body.error).toBe('receipt_invalid');
  });

  it('produção sem validação de loja: 402 com mensagem clara, até com recibo "dev" ou vazio', () => {
    for (const receipt of ['dev', 'recibo-da-loja', '', undefined]) {
      const r = status(() => assertStoreReceipt(receipt, 'Boost', { NODE_ENV: 'production' }));
      expect(r?.status).toBe(402);
      expect(r?.body.error).toBe('payment_unavailable');
      expect(r?.body.message).toMatch(/Boost/);
      expect(r?.body.message).toMatch(/Nada foi cobrado/);
    }
    expect(
      status(() =>
        assertStoreReceipt('dev', 'Boost', { NODE_ENV: 'production', ALLOW_DEV_RECEIPTS: 'true' }),
      ),
    ).toBeNull();
  });
});
