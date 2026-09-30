import { REPORT_CONTEXT_OCCURRENCES_MAX } from '@cruzei/shared-types';
import type { Prisma } from '@prisma/client';

import type { PrismaService } from '../../database/prisma.service';

import {
  autoReportContext,
  autoReportOccurrence,
  autoReportScam,
  autoReportSql,
  type AutoReportInput,
} from './auto-report';

// Denúncia automática de golpe: UMA pendente por pessoa (dedupe no banco), com a lista das conversas onde apareceu
// (uma entrada por conversa, até 10) pra ficha da moderação abrir cada uma. O SQL foi conferido num Postgres de verdade
// (tabela temporária); aqui fica o formato e os valores.

const A = '0a000000-0000-4000-8000-00000000000a';
const CONV = '0c000000-0000-4000-8000-00000000000c';
const MSG = '0d000000-0000-4000-8000-00000000000d';
const input = (o: Partial<AutoReportInput> = {}): AutoReportInput => ({
  reportedId: A,
  conversationId: CONV,
  messageId: MSG,
  match: 'me manda um pix',
  ...o,
});

describe('contexto da denúncia automática', () => {
  it('1ª ocorrência no topo (formato antigo) e na lista', () => {
    expect(autoReportContext(input())).toEqual({
      source: 'auto_filter',
      conversationId: CONV,
      messageId: MSG,
      occurrences: [{ conversationId: CONV, messageId: MSG }],
    });
    expect(autoReportOccurrence(input({ messageId: null }))).toEqual({ conversationId: CONV });
  });

  it('sem conversa: sem lista', () => {
    expect(autoReportOccurrence(input({ conversationId: null }))).toBeNull();
    expect(autoReportContext(input({ conversationId: null, messageId: null }))).toEqual({
      source: 'auto_filter',
    });
  });
});

describe('autoReportSql', () => {
  it('ON CONFLICT soma a conversa nova à lista (sem repetir conversa, até o máximo) e o trecho à descrição', () => {
    const q = autoReportSql(input());
    const text = q.text.replace(/\s+/g, ' ');
    expect(text).toContain('ON CONFLICT (reported_id, reason)');
    expect(text).toContain(
      "WHERE status = 'pending' AND reporter_id IS NULL AND (context ->> 'source') = 'auto_filter'",
    );
    expect(text).toMatch(/context = CASE/);
    expect(text).toMatch(
      /@> jsonb_build_array\(jsonb_build_object\('conversationId', \$\d+::text\)\)/,
    );
    expect(text).toMatch(/jsonb_array_length\(.*\) >= \$\d+::int/);
    expect(text).toMatch(/jsonb_set\(reports\.context, '\{occurrences\}'/);
    // pendente de antes da lista: a conversa do topo vira a 1ª entrada
    expect(text).toContain("COALESCE(reports.context -> 'occurrences'");
    expect(q.values).toContain(REPORT_CONTEXT_OCCURRENCES_MAX);
    expect(q.values).toContain(JSON.stringify({ conversationId: CONV, messageId: MSG }));
    expect(q.values).toContain(JSON.stringify(autoReportContext(input())));
    expect(q.values).toContain(CONV);
  });

  it('sem conversa: a ocorrência vai NULL (a lista não muda)', () => {
    const q = autoReportSql(input({ conversationId: null, messageId: null }));
    const occIdx = q.text.replace(/\s+/g, ' ').match(/WHEN \$(\d+)::jsonb IS NULL/);
    expect(occIdx).not.toBeNull();
    expect(q.values[Number(occIdx![1]) - 1]).toBeNull();
  });
});

describe('autoReportScam', () => {
  it('manda o SQL montado e nunca lança', async () => {
    const $queryRaw = jest.fn(async (_q: Prisma.Sql) => [{ id: 'r1', created: true }]);
    const db = { $queryRaw } as unknown as PrismaService;
    expect(await autoReportScam(db, input())).toEqual({ id: 'r1', created: true });
    expect($queryRaw.mock.calls[0][0].text).toContain('INSERT INTO reports');
    const broken = {
      $queryRaw: jest.fn(async () => {
        throw new Error('fora do ar');
      }),
    } as unknown as PrismaService;
    expect(await autoReportScam(broken, input())).toBeNull();
  });
});
