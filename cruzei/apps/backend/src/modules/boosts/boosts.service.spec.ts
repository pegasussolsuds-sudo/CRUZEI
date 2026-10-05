import type { PrismaService } from '../../database/prisma.service';

import { BoostsService } from './boosts.service';

// Boost sem recibo validado não pode sair de graça: em produção (sem validação de loja) é 402 e nada é gravado
function setup() {
  const prisma = {
    user: {
      findUnique: jest.fn(async () => ({
        visibilityMode: 'visible',
        isPaused: false,
        pausedUntil: null,
        discoveryMode: 'everyone',
      })),
    },
    boost: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: { data: { id: string } }) => ({ id: data.id })),
    },
  };
  return { svc: new BoostsService(prisma as unknown as PrismaService), prisma };
}

describe('BoostsService.purchase: recibo', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('produção sem ALLOW_DEV_RECEIPTS: 402 (mesmo com "dev") e nenhum boost criado', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_DEV_RECEIPTS;
    const { svc, prisma } = setup();
    await expect(svc.purchase('u1', 1, 'android', 'dev')).rejects.toMatchObject({ status: 402 });
    await expect(svc.purchase('u1', 1, 'android', 'qualquer-coisa')).rejects.toMatchObject({
      status: 402,
    });
    expect(prisma.boost.create).not.toHaveBeenCalled();
  });

  it('sem NODE_ENV conta como produção: 402 (mesmo com "dev") e nenhum boost criado', async () => {
    delete process.env.NODE_ENV;
    delete process.env.ALLOW_DEV_RECEIPTS;
    process.env.DEV_SHORTCUTS = 'true';
    const { svc, prisma } = setup();
    await expect(svc.purchase('u1', 1, 'android', 'dev')).rejects.toMatchObject({ status: 402 });
    expect(prisma.boost.create).not.toHaveBeenCalled();
  });

  it('development sem DEV_SHORTCUTS: "dev" também é 402', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.DEV_SHORTCUTS;
    delete process.env.ALLOW_DEV_RECEIPTS;
    const { svc, prisma } = setup();
    await expect(svc.purchase('u1', 1, 'android', 'dev')).rejects.toMatchObject({ status: 402 });
    expect(prisma.boost.create).not.toHaveBeenCalled();
  });

  it('development + DEV_SHORTCUTS: "dev" ativa; outro recibo é 402', async () => {
    process.env.NODE_ENV = 'development';
    process.env.DEV_SHORTCUTS = 'true';
    const { svc, prisma } = setup();
    await expect(svc.purchase('u1', 1, 'android', 'forjado')).rejects.toMatchObject({
      status: 402,
    });
    expect(prisma.boost.create).not.toHaveBeenCalled();
    const r = await svc.purchase('u1', 1, 'android', 'dev');
    expect(r.visibilityRadiusMeters).toBe(5000);
    expect(prisma.boost.create).toHaveBeenCalledTimes(1);
  });

  it('produção com ALLOW_DEV_RECEIPTS=true (beta fechado): "dev" ativa', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_DEV_RECEIPTS = 'true';
    const { svc, prisma } = setup();
    await svc.purchase('u1', 2, 'ios', 'dev');
    expect(prisma.boost.create).toHaveBeenCalledTimes(1);
  });
});
