import { Prisma } from '@prisma/client';

import {
  anonymizedInstallId,
  evidenceConversationIds,
  evidenceConversationsPageSql,
  evidenceExpired,
  FIRST_UUID,
  holdReasonFor,
  keepPhoneOnPurge,
  phoneReleaseHashExpirySql,
  phoneReleaseMetaExpirySql,
  RETENTION_PAGE,
  REVIEW_HOLD_MAX_DAYS,
  reviewHoldDeadline,
  supportThreadExpired,
  tombstoneData,
  urgentSupportPageSql,
  utcSql,
  type CitingReport,
} from './purge-plan';

// Regras puras da conta limpa: a linha que fica não pode ter dado pessoal (users_purged_clean_chk) nem violar os
// outros CHECKs; a prova fica o tempo certo e o que é de segurança infantil nunca sai sozinho.

const DAY = 86_400_000;
const NOW = new Date('2026-10-05T12:00:00Z');
const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';
const C3 = '33333333-3333-4333-8333-333333333333';

describe('tombstoneData', () => {
  const t = tombstoneData(NOW, new Date('2026-09-05T12:00:00Z'));

  it('zera tudo que o users_purged_clean_chk exige', () => {
    for (const k of [
      'phone',
      'email',
      'passwordHash',
      'bio',
      'instagramHandle',
      'orientation',
      'orientationConsentedAt',
      'verificationSelfieUrl',
    ] as const) {
      expect(t[k]).toBeNull();
    }
    expect(t.avatarConfig).toBe(Prisma.DbNull);
  });

  it('respeita os outros CHECKs (orientação → flags false; faixa de idade 18–99)', () => {
    expect(t.showOrientation).toBe(false);
    expect(t.sameOrientationFirst).toBe(false);
    expect(t.ageMin).toBe(18);
    expect(t.ageMax).toBe(99);
    expect((t.ageMax as number) - (t.ageMin as number)).toBeGreaterThanOrEqual(4);
  });

  it('mantém deleted_at original, marca purged_at e corta as sessões', () => {
    expect(t.deletedAt).toEqual(new Date('2026-09-05T12:00:00Z'));
    expect(t.purgedAt).toBe(NOW);
    expect(t.sessionsValidAfter).toBe(NOW);
    expect(t.name).toBe('Conta excluída');
    expect(t.isPaused).toBe(true);
    expect(t.discoveryMode).toBe('nobody');
    expect(t.premiumTier).toBe('free');
  });

  it('sem deleted_at (pedido pelo suporte) usa agora', () => {
    expect(tombstoneData(NOW, null).deletedAt).toBe(NOW);
  });
});

describe('keepPhoneOnPurge / holdReasonFor / reviewHoldDeadline', () => {
  const later = new Date(NOW.getTime() + DAY);
  const before = new Date(NOW.getTime() - DAY);

  it('banida/suspensa guarda o número; ativa só se a limpeza passou com revisão (teto)', () => {
    expect(keepPhoneOnPurge('banned')).toBe(true);
    expect(keepPhoneOnPurge('suspended')).toBe(true);
    expect(keepPhoneOnPurge('active')).toBe(false);
    expect(keepPhoneOnPurge('active', null)).toBe(false);
    expect(keepPhoneOnPurge('active', NOW)).toBe(true);
  });

  it('denúncia em análise segura sem prazo, mesmo depois do teto', () => {
    expect(holdReasonFor(2, NOW, NOW, later)).toBe('open_reports');
    expect(holdReasonFor(2, null, NOW, before)).toBe('open_reports');
  });

  it('revisão SEM denúncia segura só até o teto; depois limpa', () => {
    expect(holdReasonFor(0, NOW, NOW, later)).toBe('review_hold');
    expect(holdReasonFor(0, NOW, NOW, before)).toBeNull();
    expect(holdReasonFor(0, NOW, NOW, NOW)).toBeNull();
    expect(holdReasonFor(0, null, NOW, later)).toBeNull();
  });

  it('teto = fim do prazo de arrependimento + 30 dias', () => {
    expect(REVIEW_HOLD_MAX_DAYS).toBe(30);
    const requested = new Date('2026-09-01T00:00:00Z');
    expect(reviewHoldDeadline(requested, 30)).toEqual(new Date('2026-10-31T00:00:00Z'));
    expect(reviewHoldDeadline(requested, 0)).toEqual(new Date('2026-10-01T00:00:00Z'));
  });
});

describe('phone_releases de conta limpa (SQL)', () => {
  const U = '0a000000-0000-4000-8000-00000000000a';

  it('IP/porta/app só do pedido que a própria pessoa fez (sem admin) e só depois dos 6 meses', () => {
    const s = phoneReleaseMetaExpirySql(NOW, U);
    expect(s.text).toMatch(/SET ip = NULL, port = NULL, user_agent = NULL/);
    expect(s.text).toMatch(/new_user_id = \$1::uuid/);
    expect(s.text).toMatch(/released_by IS NULL/);
    expect(s.text).toMatch(/created_at < \$2::timestamptz/);
    expect(s.values).toEqual([U, NOW.toISOString()]);
  });

  it('retenção diária: só conta limpa ativa e sem revisão (banida guarda o mínimo)', () => {
    const s = phoneReleaseMetaExpirySql(NOW);
    expect(s.text).toMatch(/u\.id = pr\.new_user_id AND u\.purged_at IS NOT NULL/);
    expect(s.text).toMatch(/u\.account_status = 'active' AND u\.review_hold_at IS NULL/);
    expect(s.text).toMatch(/released_by IS NULL/);
    expect(s.values).toEqual([NOW.toISOString()]);
  });

  it('hash do número antigo sai pelo purged_at da conta (UTC)', () => {
    const s = phoneReleaseHashExpirySql(NOW);
    expect(s.text).toMatch(/SET phone_hash = NULL/);
    expect(s.text).toMatch(/u\.id = pr\.user_id/);
    expect(s.text).toContain("AT TIME ZONE 'UTC'");
  });
});

describe('páginas da retenção (SQL)', () => {
  it('conversas: cursor por id, ordenado, com LIMIT e sem as citadas em segurança infantil/menor', () => {
    const s = evidenceConversationsPageSql(C1, 50);
    expect(s.text).toMatch(/c\.id > \$1::uuid/);
    expect(s.text).toMatch(/ORDER BY c\.id\s+LIMIT \$\d+/);
    expect(s.text).toMatch(/NOT EXISTS/);
    expect(s.text).toMatch(/strpos\(lower\(r\.context::text\), c\.id::text\) > 0/);
    expect(s.values).toEqual(expect.arrayContaining([C1, 'child_safety', 'underage', 50]));
  });

  it('atendimentos: cursor, última mensagem antes do corte e sem pessoa com denúncia de segurança infantil', () => {
    const s = urgentSupportPageSql(FIRST_UUID, NOW, 180);
    expect(s.text).toMatch(/t\.id > \$1::uuid/);
    expect(s.text).toMatch(/t\.last_message_at < \$2::timestamptz/);
    expect(s.text).toMatch(/ORDER BY t\.id\s+LIMIT \$\d+/);
    expect(s.values[0]).toBe(FIRST_UUID);
    expect(s.values[1]).toBe(new Date(NOW.getTime() - 180 * DAY).toISOString());
    expect(s.values).toEqual(expect.arrayContaining(['child_safety', 'underage', RETENTION_PAGE]));
  });
});

describe('evidenceConversationIds', () => {
  it('pega conversationId, matchId antigo e occurrences, só das conversas da pessoa', () => {
    const contexts = [
      { source: 'chat', conversationId: C1.toUpperCase() },
      { source: 'matches', matchId: C2 },
      { source: 'auto_filter', occurrences: [{ conversationId: C3 }, { conversationId: 'lixo' }] },
      null,
      'texto',
    ];
    expect(evidenceConversationIds(contexts, [C1, C2])).toEqual(new Set([C1, C2]));
    expect(evidenceConversationIds(contexts, [C3.toUpperCase()])).toEqual(new Set([C3]));
    expect(evidenceConversationIds([], [C1]).size).toBe(0);
  });
});

describe('evidenceExpired', () => {
  const closed = (daysAgo: number, reason = 'harassment'): CitingReport => ({
    reason,
    status: 'resolved',
    reviewedAt: new Date(NOW.getTime() - daysAgo * DAY),
    createdAt: new Date(NOW.getTime() - (daysAgo + 3) * DAY),
  });

  it('nada citando: sai', () => expect(evidenceExpired([], NOW, 180)).toBe(true));

  it('180 dias contados do fim da ÚLTIMA denúncia', () => {
    expect(evidenceExpired([closed(181)], NOW, 180)).toBe(true);
    expect(evidenceExpired([closed(179)], NOW, 180)).toBe(false);
    expect(evidenceExpired([closed(400), closed(10)], NOW, 180)).toBe(false);
  });

  it('sem reviewed_at conta a criação', () => {
    const r: CitingReport = {
      reason: 'spam',
      status: 'dismissed',
      reviewedAt: null,
      createdAt: new Date(NOW.getTime() - 200 * DAY),
    };
    expect(evidenceExpired([r], NOW, 180)).toBe(true);
  });

  it('denúncia em análise segura', () => {
    expect(evidenceExpired([{ ...closed(400), status: 'pending' }], NOW, 180)).toBe(false);
    expect(evidenceExpired([{ ...closed(400), status: 'reviewing' }], NOW, 180)).toBe(false);
  });

  it('segurança infantil / menor de idade nunca sai sozinho', () => {
    expect(evidenceExpired([closed(5000, 'child_safety')], NOW, 180)).toBe(false);
    expect(evidenceExpired([closed(5000, 'underage')], NOW, 180)).toBe(false);
  });
});

describe('supportThreadExpired', () => {
  it('atendimento urgente: espera também a última mensagem', () => {
    const recent = new Date(NOW.getTime() - 10 * DAY);
    const old = new Date(NOW.getTime() - 200 * DAY);
    expect(supportThreadExpired(recent, [], NOW, 180)).toBe(false);
    expect(supportThreadExpired(old, [], NOW, 180)).toBe(true);
    expect(
      supportThreadExpired(
        old,
        [{ reason: 'underage', status: 'resolved', reviewedAt: old, createdAt: old }],
        NOW,
        180,
      ),
    ).toBe(false);
  });
});

describe('anonymizedInstallId / utcSql', () => {
  it('install_id novo sem o id antigo', () => {
    const id = anonymizedInstallId('6f1c2a54-7a0e-4a52-9b1c-3c1d2e3f4a5b');
    expect(id).toBe('del:6f1c2a547a0e4a529b1c3c1d2e3f4a5b');
    expect(id.length).toBeLessThanOrEqual(36);
  });

  it('data vira timestamptz em UTC no SQL', () => {
    const s = utcSql(NOW);
    expect(s.sql).toContain("AT TIME ZONE 'UTC'");
    expect(s.values).toEqual([NOW.toISOString()]);
  });
});
