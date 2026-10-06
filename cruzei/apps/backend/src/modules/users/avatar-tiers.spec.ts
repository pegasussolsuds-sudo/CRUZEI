import type { AvatarConfig } from '@cruzei/shared-types';
import { AVATAR_CONFIG_MAX_BYTES, AVATAR_V11_SLOTS, DEFAULT_AVATAR } from '@cruzei/shared-utils';
import { BadRequestException } from '@nestjs/common';

import type { PrismaService } from '../../database/prisma.service';
import type { ChatGateway } from '../../realtime/chat.gateway';
import type { RedisService } from '../../redis/redis.service';
import type { PhotoModerationService } from '../moderation/photo-moderation.service';

import { allowedTiersFor, UsersService } from './users.service';

// Avatar x plano sem banco: tiers liberados (Premium+ libera 'plus'), PATCH /me com config antiga e completa, teto de
// tamanho e o rebaixamento genérico. O /me e a tarefa contra o banco estão em test/db/premium-rules.db-spec.ts.

const H = 3_600_000;
const future = new Date(Date.now() + 24 * H);
const past = new Date(Date.now() - H);
const tiers = (u: Parameters<typeof allowedTiersFor>[0]) => [...allowedTiersFor(u)].sort();

/** config salva antes da v1.1: só as chaves antigas, colar ainda no accessory */
const LEGACY: Record<string, unknown> = Object.fromEntries(
  Object.entries({ ...DEFAULT_AVATAR, accessory: 'necklace' }).filter(
    ([k]) => !(AVATAR_V11_SLOTS as readonly string[]).includes(k),
  ),
);
/** completa, só itens free */
const FREE_FULL: AvatarConfig = {
  ...DEFAULT_AVATAR,
  body: 'curvy',
  faceShape: 'heart',
  hair: 'long_curly',
  top: 'flannel',
  outer: 'denim',
  neck: 'pearls',
  pride: 'pin',
  prideFlag: 'trans',
  pronouns: 'elu',
  pet: 'cat_orange',
  petPose: 'shoulder',
  vehicle: 'bike',
  held: 'coffee',
  emote: 'wave',
};
/** Premium (galáxia, fundo galáxia, dragão) + Premium+ (supernova, disco voador, coroa neon) */
const PLUS_FULL: AvatarConfig = {
  ...FREE_FULL,
  aura: 'supernova',
  auraColor: 'a_violet',
  auraLevel: 'max',
  backdrop: 'galaxy',
  pet: 'dragon',
  petPose: 'float',
  vehicle: 'ufo',
  hat: 'neon_crown',
};

function setup(user: { premiumTier: string; premiumExpiresAt: Date | null }, avatarConfig: unknown = null) {
  const prisma = {
    user: {
      findUnique: jest.fn(async () => ({ ...user, avatarConfig })),
      update: jest.fn(async (_args: { data: Record<string, unknown> }) => ({})),
    },
  };
  const redis = { invalidateProfile: jest.fn(async () => undefined) };
  const svc = new UsersService(
    prisma as unknown as PrismaService,
    redis as unknown as RedisService,
    {} as PhotoModerationService,
    {} as ChatGateway,
  );
  jest.spyOn(svc as never, 'refreshCompleteness').mockResolvedValue(undefined as never);
  jest.spyOn(svc, 'me').mockResolvedValue({} as never);
  const saved = () => prisma.user.update.mock.calls.at(-1)?.[0].data.avatarConfig as AvatarConfig;
  return { svc, prisma, redis, saved };
}

describe('allowedTiersFor (plano efetivo)', () => {
  it('free, sem usuário ou vencido: só free', () => {
    expect(tiers(null)).toEqual(['free']);
    expect(tiers({ premiumTier: 'free', premiumExpiresAt: null })).toEqual(['free']);
    expect(tiers({ premiumTier: 'premium', premiumExpiresAt: past })).toEqual(['free']);
    expect(tiers({ premiumTier: 'premium_plus', premiumExpiresAt: past })).toEqual(['free']);
  });

  it("Premium libera 'premium'; Premium+ libera também 'plus'; 'event' nunca", () => {
    expect(tiers({ premiumTier: 'premium', premiumExpiresAt: future })).toEqual([
      'free',
      'premium',
    ]);
    expect(tiers({ premiumTier: 'premium_plus', premiumExpiresAt: future })).toEqual([
      'free',
      'plus',
      'premium',
    ]);
    expect(tiers({ premiumTier: 'premium_plus', premiumExpiresAt: null })).toContain('plus');
  });
});

describe('PATCH /me com avatar', () => {
  it('aceita config antiga sem as chaves novas: salva completa, colar vai pro neck', async () => {
    const t = setup({ premiumTier: 'free', premiumExpiresAt: null });
    await t.svc.update('u', { avatar: LEGACY });
    expect(t.saved()).toEqual({ ...DEFAULT_AVATAR, accessory: 'none', neck: 'necklace' });
  });

  it('app antigo (sem as chaves novas) não apaga pet, veículo, pronomes… salvos de um aparelho novo', async () => {
    const t = setup({ premiumTier: 'free', premiumExpiresAt: null }, FREE_FULL);
    await t.svc.update('u', { avatar: { ...LEGACY, hair: 'afro', accessory: 'none' } });
    const v11 = Object.fromEntries(AVATAR_V11_SLOTS.map((k) => [k, FREE_FULL[k]]));
    expect(t.saved()).toEqual({ ...DEFAULT_AVATAR, ...v11, hair: 'afro' });
    // salvo com item de plano que venceu: a chave nova volta pelo plano de agora (pet pago cai)
    const exp = setup({ premiumTier: 'premium_plus', premiumExpiresAt: past }, PLUS_FULL);
    await exp.svc.update('u', { avatar: LEGACY });
    expect(exp.saved()).toMatchObject({ pet: 'none', vehicle: 'none', pronouns: 'elu', held: 'coffee', backdrop: 'none' });
  });

  it('aceita config completa com os slots novos (free)', async () => {
    const t = setup({ premiumTier: 'free', premiumExpiresAt: null });
    await t.svc.update('u', { avatar: FREE_FULL });
    expect(t.saved()).toEqual(FREE_FULL);
  });

  it("Premium+ vigente salva itens 'plus'; Premium e Premium+ vencido recebem 400", async () => {
    const plus = setup({ premiumTier: 'premium_plus', premiumExpiresAt: future });
    await plus.svc.update('u', { avatar: PLUS_FULL });
    expect(plus.saved()).toEqual(PLUS_FULL);

    for (const user of [
      { premiumTier: 'premium', premiumExpiresAt: future },
      { premiumTier: 'premium_plus', premiumExpiresAt: past },
    ]) {
      const t = setup(user);
      await expect(t.svc.update('u', { avatar: PLUS_FULL })).rejects.toThrow(
        'avatar inválido ou com itens bloqueados',
      );
      expect(t.prisma.user.update).not.toHaveBeenCalled();
    }
  });

  it(`teto de ${AVATAR_CONFIG_MAX_BYTES} bytes: a maior config real cabe; acima disso é 400`, async () => {
    expect(Buffer.byteLength(JSON.stringify(PLUS_FULL))).toBeLessThan(AVATAR_CONFIG_MAX_BYTES);
    const t = setup({ premiumTier: 'premium_plus', premiumExpiresAt: null });
    const big = { ...PLUS_FULL, pad: 'x'.repeat(AVATAR_CONFIG_MAX_BYTES) };
    await expect(t.svc.update('u', { avatar: big })).rejects.toThrow(BadRequestException);
    await expect(t.svc.update('u', { avatar: big })).rejects.toThrow('avatar muito grande');
  });

  it('id desconhecido ou sem v=1: 400', async () => {
    const t = setup({ premiumTier: 'premium_plus', premiumExpiresAt: null });
    await expect(t.svc.update('u', { avatar: { ...FREE_FULL, pet: 'tigre' } })).rejects.toThrow(
      BadRequestException,
    );
    await expect(t.svc.update('u', { avatar: { ...FREE_FULL, v: 2 } })).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('downgradeAvatar (genérico)', () => {
  it("Premium+ → Premium: só os itens 'plus' caem; o resto fica", async () => {
    const t = setup({ premiumTier: 'premium', premiumExpiresAt: future });
    const out = await t.svc.downgradeAvatar(
      'u',
      allowedTiersFor({ premiumTier: 'premium', premiumExpiresAt: future }),
      PLUS_FULL,
    );
    expect(out).toEqual({ ...PLUS_FULL, aura: 'none', vehicle: 'none', hat: 'none' });
    expect(t.saved()).toEqual(out);
    expect(t.redis.invalidateProfile).toHaveBeenCalledWith('u');
  });

  it('vencido → free: tira premium e plus (pet some, posição guardada)', async () => {
    const t = setup({ premiumTier: 'free', premiumExpiresAt: null });
    const out = (await t.svc.downgradeAvatarToFree('u', PLUS_FULL)) as AvatarConfig;
    expect(out).toMatchObject({
      aura: 'none',
      backdrop: 'none',
      pet: 'none',
      vehicle: 'none',
      hat: 'none',
    });
    expect(out).toMatchObject({ body: 'curvy', pronouns: 'elu', pride: 'pin', held: 'coffee' });
  });

  it('config já dentro do plano, antiga, nula ou não-objeto: não grava nada', async () => {
    const t = setup({ premiumTier: 'free', premiumExpiresAt: null });
    const free = allowedTiersFor(null);
    expect(await t.svc.downgradeAvatar('u', free, FREE_FULL)).toBe(FREE_FULL);
    expect(await t.svc.downgradeAvatar('u', free, LEGACY)).toBe(LEGACY);
    expect(await t.svc.downgradeAvatar('u', free, null)).toBeNull();
    expect(await t.svc.downgradeAvatar('u', free, 'lixo')).toBe('lixo');
    expect(t.prisma.user.update).not.toHaveBeenCalled();
  });
});
