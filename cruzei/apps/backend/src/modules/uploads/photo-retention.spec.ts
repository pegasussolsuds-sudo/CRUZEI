import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  isRetainedPhoto,
  isUrgentPhoto,
  ownerVisible,
  RETAINED_LABEL,
  retainedMark,
  retainedOrderIndex,
  withRetainedMark,
} from './photo-retention';

// Foto retida por denúncia: marca em moderation_labels, invisível pro dono, preservando os rótulos da análise.

describe('photo-retention', () => {
  const mark = { at: '2026-10-05T12:00:00.000Z', prevStatus: 'approved', wasMain: true };

  it('marca preserva os rótulos (o urgent continua valendo pros 180 dias) e é reconhecida', () => {
    const labels = { labels: ['menor'], urgent: true, reason: null };
    const out = withRetainedMark(labels, mark);
    expect(out).toEqual({ ...labels, [RETAINED_LABEL]: mark });
    expect(isRetainedPhoto(out)).toBe(true);
    expect(isUrgentPhoto(out)).toBe(true);
    expect(retainedMark(out)).toEqual(mark);
    // não muta o original
    expect(isRetainedPhoto(labels)).toBe(false);
  });

  it('sem rótulo, rótulo estranho ou sem a chave: não é retida', () => {
    for (const v of [null, undefined, 'x', 1, [], ['retainedByReport'], { labels: [] }]) {
      expect(isRetainedPhoto(v)).toBe(false);
      expect(retainedMark(v)).toBeNull();
    }
    expect(withRetainedMark(null, mark)).toEqual({ [RETAINED_LABEL]: mark });
    expect(withRetainedMark(['lixo'], mark)).toEqual({ [RETAINED_LABEL]: mark });
  });

  it('igual ao SQL (-> IS NOT NULL): basta a chave existir, até com valor null', () => {
    expect(isRetainedPhoto({ [RETAINED_LABEL]: null })).toBe(true);
    expect(retainedMark({ [RETAINED_LABEL]: null })).toEqual({
      at: '',
      prevStatus: 'approved',
      wasMain: false,
    });
  });

  it('ownerVisible tira só as retidas e mantém a ordem', () => {
    const photos = [
      { id: 'a', moderationLabels: null },
      { id: 'r', moderationLabels: withRetainedMark({ urgent: false }, mark) },
      { id: 'b', moderationLabels: { labels: ['sem alertas'] } },
    ];
    expect(ownerVisible(photos).map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('order_index da retida fica sempre abaixo de tudo (negativo e único)', () => {
    expect(retainedOrderIndex(null)).toBe(-1);
    expect(retainedOrderIndex(0)).toBe(-1);
    expect(retainedOrderIndex(3)).toBe(-1);
    expect(retainedOrderIndex(-1)).toBe(-2);
    expect(retainedOrderIndex(-5)).toBe(-6);
  });

  it('urgent aceita boolean ou o texto do gatilho', () => {
    expect(isUrgentPhoto({ urgent: 'true' })).toBe(true);
    expect(isUrgentPhoto({ urgent: false })).toBe(false);
    expect(isUrgentPhoto(null)).toBe(false);
  });

  it('a chave da marca é a mesma do índice parcial da migration e do SQL do GC', () => {
    const mig = fs.readFileSync(
      path.join(
        __dirname,
        '../../../prisma/migrations/20261005000300_photo_retention_gc_idx/migration.sql',
      ),
      'utf8',
    );
    expect(mig).toContain(`(moderation_labels -> '${RETAINED_LABEL}') IS NOT NULL`);
    const gc = fs.readFileSync(path.join(__dirname, 'media-gc.service.ts'), 'utf8');
    expect(gc).toContain(`(x.moderation_labels -> '${RETAINED_LABEL}') IS NOT NULL`);
  });
});
