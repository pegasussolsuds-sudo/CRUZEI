import {
  confirmMatches,
  deletionPendingOf,
  EXPORT_SAVE_FAILED,
  exportFileName,
  exportRunStatus,
  exportSaveFileName,
  forgetSummary,
  isPickerCancel,
  keepPendingAfter,
  longDateBR,
  runDataExport,
  type ExportDeps,
  type ExportRun,
  type SaveOutcome,
} from './accountPrivacy';

describe('isPickerCancel', () => {
  it('reconhece o cancelamento do seletor (Android e iOS)', () => {
    expect(isPickerCancel({ code: 'ERR_PICKER_CANCELLED', message: 'The file picker was cancelled by the user' })).toBe(true);
    expect(isPickerCancel({ message: 'File picking was cancelled by the user' })).toBe(true);
  });
  it('outros erros não são cancelamento', () => {
    expect(isPickerCancel(new Error('Not implemented'))).toBe(false);
    expect(isPickerCancel(null)).toBe(false);
  });
});

describe('exportFileName', () => {
  it('usa o dia de São Paulo (igual ao servidor)', () => {
    // 01:30 UTC do dia 6 ainda é dia 5 em São Paulo
    expect(exportFileName(new Date('2026-10-06T01:30:00Z'))).toBe('metch-meus-dados-2026-10-05.json');
    expect(exportFileName(new Date('2026-10-06T15:00:00Z'))).toBe('metch-meus-dados-2026-10-06.json');
  });
});

describe('exportSaveFileName', () => {
  it('nome único com a hora de São Paulo (2ª cópia do dia não esbarra na 1ª)', () => {
    expect(exportSaveFileName(new Date('2026-10-06T01:30:05Z'))).toBe('metch-meus-dados-2026-10-05-22h30m05.json');
    expect(exportSaveFileName(new Date('2026-10-06T01:30:06Z'))).not.toBe(
      exportSaveFileName(new Date('2026-10-06T01:30:05Z')),
    );
  });
});

describe('runDataExport', () => {
  const JSON_TXT = '{"format":"metch-data-export"}';
  const deps = (over: Partial<ExportDeps<'pasta'>> = {}): ExportDeps<'pasta'> => ({
    pickFolder: jest.fn(async () => 'pasta' as const),
    fetchJson: jest.fn(async () => JSON_TXT),
    save: jest.fn(async () => ({ kind: 'saved', fileName: 'f.json' }) as SaveOutcome),
    ...over,
  });

  it('cancelar a pasta não baixa nada (não gasta a cópia)', async () => {
    const d = deps({ pickFolder: jest.fn(async () => 'cancelled' as const) });
    expect(await runDataExport(d, null)).toEqual({ kind: 'picker_cancelled' });
    expect(d.fetchJson).not.toHaveBeenCalled();
  });

  it('download falhou: fetch_failed (aí sim pode ser falta de conexão)', async () => {
    const err = new Error('Network Error');
    const d = deps({ fetchJson: jest.fn(async () => Promise.reject(err)) });
    expect(await runDataExport(d, null)).toEqual({ kind: 'fetch_failed', error: err });
    expect(d.save).not.toHaveBeenCalled();
  });

  it('baixou mas não salvou: save_failed guarda o JSON', async () => {
    const err = new Error('EACCES');
    const d = deps({ save: jest.fn(async () => Promise.reject(err)) });
    expect(await runDataExport(d, null)).toEqual({ kind: 'save_failed', error: err, json: JSON_TXT });
  });

  it('com a cópia em mãos: salva de novo SEM pedir outra ao servidor', async () => {
    const d = deps();
    const r = await runDataExport(d, 'guardado');
    expect(d.fetchJson).not.toHaveBeenCalled();
    expect(d.save).toHaveBeenCalledWith('guardado', 'pasta');
    expect(r).toMatchObject({ kind: 'done', json: 'guardado' });
  });

  it('seletor indisponível: salva sem pasta (cai no Compartilhar)', async () => {
    const d = deps({ pickFolder: jest.fn(async () => 'unsupported' as const) });
    await runDataExport(d, null);
    expect(d.save).toHaveBeenCalledWith(JSON_TXT, null);
  });
});

describe('keepPendingAfter / exportRunStatus', () => {
  const saved: ExportRun = { kind: 'done', outcome: { kind: 'saved', fileName: 'f.json' }, json: 'j' };
  const failed: ExportRun = { kind: 'save_failed', error: new Error('x'), json: 'j' };

  it('guarda a cópia até salvar ou compartilhar', () => {
    expect(keepPendingAfter(failed, null)).toBe('j');
    expect(keepPendingAfter(saved, 'j')).toBeNull();
    expect(keepPendingAfter({ kind: 'done', outcome: { kind: 'shared' }, json: 'j' }, null)).toBeNull();
    expect(keepPendingAfter({ kind: 'done', outcome: { kind: 'cancelled' }, json: 'j' }, null)).toBe('j');
    expect(keepPendingAfter({ kind: 'picker_cancelled' }, 'j')).toBe('j');
    expect(keepPendingAfter({ kind: 'fetch_failed', error: null }, null)).toBeNull();
  });

  it('falha ao salvar tem mensagem própria (não é "Sem conexão")', () => {
    const net = jest.fn(() => 'Sem conexão agora. Tenta de novo?');
    const s = exportRunStatus(failed, net);
    expect(s).toEqual({ tone: 'danger', text: EXPORT_SAVE_FAILED });
    expect(s!.text).toMatch(/Não deu pra salvar na pasta/);
    expect(s!.text).toMatch(/não gasta outra cópia/);
    expect(net).not.toHaveBeenCalled();
  });

  it('download falhado usa a mensagem da rede/servidor; seletor fechado não muda o aviso', () => {
    expect(exportRunStatus({ kind: 'fetch_failed', error: 1 }, () => 'limite')).toEqual({ tone: 'danger', text: 'limite' });
    expect(exportRunStatus({ kind: 'picker_cancelled' }, () => 'x')).toBeNull();
    expect(exportRunStatus(saved, () => 'x')).toEqual({
      tone: 'ok',
      text: 'Pronto! Salvamos o arquivo f.json na pasta que você escolheu.',
    });
  });
});

describe('deletionPendingOf', () => {
  const ok = {
    error: 'account_deletion_pending',
    message: 'm',
    challengeId: 'c',
    requestedAt: '2026-10-01T00:00:00Z',
    scheduledFor: '2026-10-31T00:00:00Z',
    expiresIn: 600,
  };
  it('aceita o corpo do 409', () => expect(deletionPendingOf(ok)).toBe(ok));
  it('recusa outros corpos', () => {
    expect(deletionPendingOf({ ...ok, error: 'conflict' })).toBeNull();
    expect(deletionPendingOf({ ...ok, challengeId: undefined })).toBeNull();
    expect(deletionPendingOf({ ...ok, scheduledFor: 5 })).toBeNull();
    expect(deletionPendingOf(undefined)).toBeNull();
  });
});

describe('longDateBR', () => {
  it('dia e mês por extenso em São Paulo', () => {
    expect(longDateBR('2026-11-03T12:00:00Z')).toMatch(/3 de novembro/);
  });
  it('data inválida vira vazio', () => expect(longDateBR('xx')).toBe(''));
});

describe('forgetSummary', () => {
  it('lista o que saiu', () => {
    const t = forgetSummary({ positions: 12, checkins: 2, placeVotes: 1, learnedHome: true });
    expect(t).toContain('12 registros de posição, 2 presenças em lugares e 1 "estou aqui"');
    expect(t).toContain('casa aprendida');
  });
  it('sem nada além das posições', () => {
    const t = forgetSummary({ positions: 1, checkins: 0, placeVotes: 0, learnedHome: false });
    expect(t).toMatch(/^Apagamos 1 registro de posição\./);
    expect(t).not.toContain('casa aprendida');
  });
});

describe('confirmMatches', () => {
  it('compara exato, ignorando espaço nas pontas', () => {
    expect(confirmMatches(' EXCLUIR ', 'EXCLUIR')).toBe(true);
    expect(confirmMatches('excluir', 'EXCLUIR')).toBe(false);
    expect(confirmMatches('EXCLUI', 'EXCLUIR')).toBe(false);
  });
});
