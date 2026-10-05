// Conta e privacidade: funções puras (sem módulo nativo; o store de auth e os testes importam daqui).
import {
  DATA_EXPORT_FILE_PREFIX,
  type AccountDeletionPendingError,
  type LocationHistoryForgetResponse,
} from '@cruzei/shared-types';

/** cancelamento do seletor de pasta (Android: ERR_PICKER_CANCELLED; iOS: FilePickingCancelled) */
export function isPickerCancel(e: unknown): boolean {
  const err = e as { code?: unknown; message?: unknown } | null;
  return /cancel/i.test(`${String(err?.code ?? '')} ${String(err?.message ?? '')}`);
}

/** metch-meus-dados-AAAA-MM-DD.json (dia de São Paulo, igual ao servidor) */
export function exportFileName(now = new Date()): string {
  const d = now.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  return `${DATA_EXPORT_FILE_PREFIX}${/^\d{4}-\d{2}-\d{2}$/.test(d) ? d : now.toISOString().slice(0, 10)}.json`;
}

/**
 * metch-meus-dados-AAAA-MM-DD-HHhMMmSS.json (hora de São Paulo): nome único pra salvar na pasta — a 2ª cópia do dia
 * ou uma nova tentativa não esbarram num arquivo que já existe.
 */
export function exportSaveFileName(now = new Date()): string {
  const t = now.toLocaleTimeString('en-GB', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const m = /^(\d{2}):(\d{2}):(\d{2})$/.exec(t);
  const hms = m ? `${m[1]}h${m[2]}m${m[3]}` : now.toISOString().slice(11, 19).replace(/:/g, '');
  return exportFileName(now).replace(/\.json$/, `-${hms}.json`);
}

export type SaveOutcome =
  | { kind: 'saved'; fileName: string }
  | { kind: 'shared' }
  | { kind: 'cancelled' }
  | { kind: 'too_big' };

export const EXPORT_SAVE_FAILED =
  'Não deu pra salvar na pasta. Tua cópia já tá baixada: toca em "Tentar salvar de novo" e escolhe outra pasta (não gasta outra cópia do dia).';

/** resultado de uma rodada do "Baixar meus dados" */
export type ExportRun =
  | { kind: 'picker_cancelled' }
  /** download falhou: a cópia do dia não foi entregue (o servidor devolve se a montagem falhou) */
  | { kind: 'fetch_failed'; error: unknown }
  /** baixou mas não salvou: o JSON fica guardado pra tentar salvar de novo sem pedir outra cópia */
  | { kind: 'save_failed'; error: unknown; json: string }
  | { kind: 'done'; outcome: SaveOutcome; json: string };

export interface ExportDeps<F> {
  pickFolder: () => Promise<F | 'cancelled' | 'unsupported'>;
  fetchJson: () => Promise<string>;
  save: (json: string, folder: F | null) => Promise<SaveOutcome>;
}

/**
 * Uma rodada: pasta ANTES (cancelar não gasta a cópia), download só se ainda não tem a cópia em mãos (`pending`), e o
 * salvar num passo separado — falha ao gravar não vira "Sem conexão" nem joga fora o que já foi baixado.
 */
export async function runDataExport<F>(deps: ExportDeps<F>, pending: string | null): Promise<ExportRun> {
  const folder = await deps.pickFolder();
  if (folder === 'cancelled') return { kind: 'picker_cancelled' };
  let json = pending;
  if (json === null) {
    try {
      json = await deps.fetchJson();
    } catch (error) {
      return { kind: 'fetch_failed', error };
    }
  }
  try {
    const outcome = await deps.save(json, folder === 'unsupported' ? null : folder);
    return { kind: 'done', outcome, json };
  } catch (error) {
    return { kind: 'save_failed', error, json };
  }
}

export type ExportStatus = { tone: 'ok' | 'danger'; text: string };

/** aviso da tela pra cada resultado; null = não muda nada (seletor fechado) */
export function exportRunStatus(run: ExportRun, fetchErrorText: (e: unknown) => string): ExportStatus | null {
  switch (run.kind) {
    case 'picker_cancelled':
      return null;
    case 'fetch_failed':
      return { tone: 'danger', text: fetchErrorText(run.error) };
    case 'save_failed':
      return { tone: 'danger', text: EXPORT_SAVE_FAILED };
    case 'done':
      switch (run.outcome.kind) {
        case 'saved':
          return { tone: 'ok', text: `Pronto! Salvamos o arquivo ${run.outcome.fileName} na pasta que você escolheu.` };
        case 'shared':
          return { tone: 'ok', text: 'Pronto! O arquivo foi compartilhado. Guarda num lugar seguro.' };
        case 'too_big':
          return {
            tone: 'danger',
            text: 'O arquivo ficou grande demais pra compartilhar daqui. Fala com o suporte que a gente manda por e-mail.',
          };
        case 'cancelled':
          return { tone: 'ok', text: 'Tua cópia continua aqui: toca em "Tentar salvar de novo" quando quiser.' };
      }
  }
}

/** a cópia em mãos ainda precisa ser guardada? (salvou ou compartilhou = não) */
export function keepPendingAfter(run: ExportRun, pending: string | null): string | null {
  switch (run.kind) {
    case 'picker_cancelled':
      return pending;
    case 'fetch_failed':
      return null;
    case 'save_failed':
      return run.json;
    case 'done':
      return run.outcome.kind === 'saved' || run.outcome.kind === 'shared' ? null : run.json;
  }
}

/** corpo do 409 do login quando a conta tem exclusão pedida no prazo */
export function deletionPendingOf(data: unknown): AccountDeletionPendingError | null {
  const d = data as Partial<AccountDeletionPendingError> | null | undefined;
  if (!d || d.error !== 'account_deletion_pending' || typeof d.challengeId !== 'string') return null;
  if (typeof d.scheduledFor !== 'string') return null;
  return d as AccountDeletionPendingError;
}

/** "3 de novembro" (São Paulo) */
export function longDateBR(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: 'numeric', month: 'long' });
}

/** resumo do que saiu ao apagar o histórico */
export function forgetSummary(r: LocationHistoryForgetResponse): string {
  const parts: string[] = [];
  parts.push(r.positions === 1 ? '1 registro de posição' : `${r.positions} registros de posição`);
  if (r.checkins) parts.push(r.checkins === 1 ? '1 presença em lugar' : `${r.checkins} presenças em lugares`);
  if (r.placeVotes) parts.push(r.placeVotes === 1 ? '1 "estou aqui"' : `${r.placeVotes} "estou aqui"`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}` : parts[0];
  return `Apagamos ${list}${r.learnedHome ? ', e a casa aprendida' : ''}. Sua posição atual também saiu do mapa e volta quando o app atualizar.`;
}

/** a palavra digitada confere? (sem espaço nas pontas; o servidor compara exato com 'EXCLUIR') */
export function confirmMatches(typed: string, word: string): boolean {
  return typed.trim() === word;
}
