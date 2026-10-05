// Conta e privacidade (LGPD): prévia/pedido de exclusão, cópia dos dados (JSON salvo onde a pessoa escolher, com o
// expo-file-system que já vem no app) e apagar histórico de localização. Funções puras em accountPrivacy.ts.
import { Directory } from 'expo-file-system';
import { Share } from 'react-native';
import type { AccountDeletionPreview, LocationHistoryForgetResponse } from '@cruzei/shared-types';

import { exportFileName, exportSaveFileName, isPickerCancel, type SaveOutcome } from './accountPrivacy';
import { api } from './api';

export * from './accountPrivacy';

/** cópia grande demais pro "Compartilhar" do sistema (Android estoura acima de ~1 MB numa intent) */
const SHARE_MAX_CHARS = 400_000;

export async function getDeletionPreview(): Promise<AccountDeletionPreview> {
  return (await api.get<AccountDeletionPreview>('/me/deletion')).data;
}

export async function forgetLocationHistory(learnedHome: boolean): Promise<LocationHistoryForgetResponse> {
  return (await api.delete<LocationHistoryForgetResponse>('/me/location-history', { params: { learnedHome } })).data;
}

/** o JSON como veio do servidor (texto, sem reformatar); timeout maior: conta antiga tem muita coisa */
export async function fetchMyDataExport(): Promise<string> {
  const res = await api.get<string>('/me/export', {
    responseType: 'text',
    transformResponse: (d: unknown) => d,
    timeout: 60_000,
  });
  return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
}

/** a pessoa escolhe a pasta (Downloads, Drive…) ANTES de gastar uma cópia do dia */
export async function pickExportFolder(): Promise<Directory | 'cancelled' | 'unsupported'> {
  try {
    return await Directory.pickDirectoryAsync();
  } catch (e) {
    return isPickerCancel(e) ? 'cancelled' : 'unsupported';
  }
}

/**
 * grava na pasta escolhida com nome único (hora no nome: não esbarra em arquivo que já existe); se a gravação falhar,
 * tira o arquivo pela metade e repassa o erro. Sem pasta (seletor indisponível), cai no "Compartilhar" do sistema.
 */
export async function saveExport(json: string, folder: Directory | null, now = new Date()): Promise<SaveOutcome> {
  if (folder) {
    const fileName = exportSaveFileName(now);
    const file = folder.createFile(fileName, 'application/json');
    try {
      file.write(json);
    } catch (e) {
      try {
        file.delete();
      } catch {
        /* sem permissão pra apagar: fica o arquivo vazio, a pessoa apaga */
      }
      throw e;
    }
    return { kind: 'saved', fileName };
  }
  const fileName = exportFileName(now);
  if (json.length > SHARE_MAX_CHARS) return { kind: 'too_big' };
  const r = await Share.share({ title: fileName, message: json });
  return r.action === Share.dismissedAction ? { kind: 'cancelled' } : { kind: 'shared' };
}
