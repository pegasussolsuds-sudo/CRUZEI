// Recibo de compra da loja (Boost; a assinatura segue a mesma regra em SubscriptionsService.subscribe).
// A validação de verdade (App Store Server API / Google Play Developer API) ainda não existe: o recibo 'dev' só vale
// fora de produção (ou com ALLOW_DEV_RECEIPTS=true); qualquer outro recibo é recusado com 402 — nada é ativado.
import { HttpException } from '@nestjs/common';

type Env = Record<string, string | undefined>;

/** recibo 'dev' aceito? só fora de produção ou com ALLOW_DEV_RECEIPTS=true */
export function devReceiptsAllowed(env: Env = process.env): boolean {
  return env.NODE_ENV !== 'production' || env.ALLOW_DEV_RECEIPTS === 'true';
}

/** 402 com mensagem clara quando o recibo não pode ser aceito (produção sem validação de loja, ou recibo inválido) */
export function assertStoreReceipt(
  receipt: string | null | undefined,
  what: string,
  env: Env = process.env,
): void {
  const devOk = devReceiptsAllowed(env);
  if (receipt === 'dev' && devOk) return;
  if (!devOk) {
    throw new HttpException(
      {
        error: 'payment_unavailable',
        message: `A compra de ${what} ainda não está disponível: não conseguimos validar o pagamento com a loja. Nada foi cobrado nem ativado.`,
      },
      402,
    );
  }
  throw new HttpException(
    { error: 'receipt_invalid', message: `Recibo inválido: ${what} não foi ativado.` },
    402,
  );
}
