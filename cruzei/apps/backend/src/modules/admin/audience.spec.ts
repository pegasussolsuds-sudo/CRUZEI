import { BadRequestException } from '@nestjs/common';

import {
  CONFIRM_ABOVE,
  audienceSql,
  needsConfirmation,
  parseAudience,
  parseChannels,
  parseCity,
} from './audience';

// Montagem do público das campanhas (regras puras; a contagem de verdade está em test/db/campaigns.db-spec.ts)

const flat = (s: { sql: string }) => s.sql.replace(/\s+/g, ' ');

describe('parseAudience', () => {
  it('aceita os tipos do contrato e devolve só os campos dele', () => {
    expect(parseAudience({ kind: 'all', extra: 1 })).toEqual({ kind: 'all' });
    expect(parseAudience({ kind: 'premium' })).toEqual({ kind: 'premium' });
    expect(parseAudience({ kind: 'free' })).toEqual({ kind: 'free' });
    expect(parseAudience({ kind: 'city', city: '  Uberlândia ' })).toEqual({
      kind: 'city',
      city: 'Uberlândia',
    });
    expect(parseAudience({ kind: 'radius', lat: -18.9, lng: -48.2, radiusM: 1500.4 })).toEqual({
      kind: 'radius',
      lat: -18.9,
      lng: -48.2,
      radiusM: 1500,
    });
    expect(parseAudience({ kind: 'user', userId: 'AAAAAAAA-0000-4000-8000-000000000001' })).toEqual(
      {
        kind: 'user',
        userId: 'aaaaaaaa-0000-4000-8000-000000000001',
      },
    );
  });

  it.each([
    [null],
    [[]],
    [{ kind: 'everyone' }],
    [{ kind: 'city', city: 'x' }],
    [{ kind: 'radius', lat: 91, lng: 0, radiusM: 500 }],
    [{ kind: 'radius', lat: 0, lng: 0, radiusM: 50 }],
    [{ kind: 'radius', lat: 0, lng: 0, radiusM: 500_000 }],
    [{ kind: 'user', userId: "1' OR '1'='1" }],
  ])('recusa %j com 400', (raw) => {
    expect(() => parseAudience(raw)).toThrow(BadRequestException);
  });
});

describe('parseChannels / parseCity / confirmação', () => {
  it('canais: pelo menos um ligado; só booleanos de verdade contam', () => {
    expect(parseChannels({ push: true, inbox: false })).toEqual({ push: true, inbox: false });
    expect(() => parseChannels({ push: 'yes', inbox: 0 })).toThrow(BadRequestException);
    expect(() => parseChannels(undefined)).toThrow(BadRequestException);
  });

  it('cidade com UF desempata; sem UF vale o nome', () => {
    expect(parseCity('Uberlândia/MG')).toEqual({ name: 'Uberlândia', state: 'MG' });
    expect(parseCity('Santa Luzia - pb')).toEqual({ name: 'Santa Luzia', state: 'PB' });
    expect(parseCity('São Paulo')).toEqual({ name: 'São Paulo', state: null });
  });

  it("confirmação: sempre no público 'all'; nos outros só acima do teto", () => {
    expect(needsConfirmation({ kind: 'all' }, 3)).toBe(true);
    expect(needsConfirmation({ kind: 'premium' }, CONFIRM_ABOVE)).toBe(false);
    expect(needsConfirmation({ kind: 'premium' }, CONFIRM_ABOVE + 1)).toBe(true);
  });
});

describe('audienceSql', () => {
  it('toda audiência exclui apagadas, não-ativas e quem desligou o tipo de aviso', () => {
    for (const a of [
      { kind: 'all' as const },
      { kind: 'premium' as const },
      { kind: 'free' as const },
      { kind: 'city' as const, city: 'Uberlândia' },
      { kind: 'radius' as const, lat: -18.9, lng: -48.2, radiusM: 1000 },
      { kind: 'user' as const, userId: 'aaaaaaaa-0000-4000-8000-000000000001' },
    ]) {
      const sql = flat(audienceSql(a, 'campaigns'));
      expect(sql).toContain('u.deleted_at IS NULL');
      expect(sql).toContain("u.account_status = 'active'");
      expect(sql).toContain('p.campaigns = false');
    }
  });

  it('campanha de evento olha a preferência de eventos', () => {
    const sql = flat(audienceSql({ kind: 'all' }, 'events'));
    expect(sql).toContain('p.events = false');
    expect(sql).not.toContain('p.campaigns');
  });

  it('valores vão como parâmetro (nunca colados no SQL)', () => {
    const q = audienceSql(
      { kind: 'user', userId: 'aaaaaaaa-0000-4000-8000-000000000001' },
      'campaigns',
    );
    expect(q.sql).not.toContain('aaaaaaaa');
    expect(q.values).toContain('aaaaaaaa-0000-4000-8000-000000000001');
    const c = audienceSql({ kind: 'city', city: 'Uberlândia/MG' }, 'campaigns');
    expect(c.sql).not.toContain('Uberl');
    expect(c.values).toEqual(expect.arrayContaining(['Uberlândia', 'MG']));
    const r = audienceSql({ kind: 'radius', lat: -18.9, lng: -48.2, radiusM: 1000 }, 'campaigns');
    expect(flat(r)).toContain('ST_DWithin');
    expect(r.values).toEqual(expect.arrayContaining([-48.2, -18.9, 1000]));
  });

  it('premium = pago e vigente; free = o contrário', () => {
    expect(flat(audienceSql({ kind: 'premium' }, 'campaigns'))).toContain(
      "u.premium_tier IN ('premium', 'premium_plus')",
    );
    expect(flat(audienceSql({ kind: 'free' }, 'campaigns'))).toContain(
      "NOT (u.premium_tier IN ('premium', 'premium_plus')",
    );
  });
});
