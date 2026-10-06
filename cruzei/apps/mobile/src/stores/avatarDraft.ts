import type { AvatarConfig } from '@cruzei/shared-types';
import { normalizeAvatarConfig } from '@cruzei/shared-utils';
import * as SecureStore from 'expo-secure-store';

// Rascunho do editor do avatar, por conta e por aparelho. Guarda o que a pessoa está experimentando (inclusive itens
// bloqueados) pra não perder nada ao sair pro Paywall, voltar sem salvar ou o app fechar no meio. Some ao salvar,
// ao descartar e ao pular a etapa do cadastro.
//
// Duas camadas: memória (síncrona: a volta do Paywall já abre com o rascunho, sem piscar o avatar salvo) e SecureStore
// (sobrevive ao app fechado; string curta, sem dado pessoal além do visual do avatar).

export interface AvatarDraft {
  config: AvatarConfig;
  /** aba aberta quando o rascunho foi guardado (volta nela) */
  tab?: string;
  /** quando foi guardado (ms) */
  at: number;
}

/** onde o rascunho fica (SecureStore no app; memória nos testes) */
export interface AvatarDraftStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

const KEY_PREFIX = 'metch.avatarDraft.v1.';
/** rascunho esquecido há mais que isso não volta (a pessoa nem lembra mais o que estava montando) */
export const AVATAR_DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

let storage: AvatarDraftStorage = {
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value),
  del: (key) => SecureStore.deleteItemAsync(key),
};

/** null = sabemos que não tem rascunho; ausente = ainda não lido do aparelho */
const memory = new Map<string, AvatarDraft | null>();

/** testes: troca o armazenamento e zera a memória */
export function setAvatarDraftStorage(s: AvatarDraftStorage): void {
  storage = s;
  memory.clear();
}

/** chave do SecureStore (só aceita letras, números, ".", "-" e "_") */
export function avatarDraftKey(userId: string): string {
  return KEY_PREFIX + userId.replace(/[^A-Za-z0-9._-]/g, '_');
}

export function encodeAvatarDraft(d: AvatarDraft): string {
  return JSON.stringify({ v: 1, at: d.at, tab: d.tab, config: d.config });
}

/** lê o que veio do aparelho; null se estiver vazio, corrompido, velho demais ou de outra versão */
export function decodeAvatarDraft(raw: string | null | undefined, now = Date.now()): AvatarDraft | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as { v?: unknown; at?: unknown; tab?: unknown; config?: unknown };
    if (o?.v !== 1 || typeof o.at !== 'number' || typeof o.config !== 'object' || o.config === null) return null;
    if (now - o.at > AVATAR_DRAFT_MAX_AGE_MS || o.at > now + 60_000) return null;
    // normaliza com todos os tiers: o rascunho guarda também o que a pessoa experimentou sem ter liberado
    const draft: AvatarDraft = { config: normalizeAvatarConfig(o.config), at: o.at };
    if (typeof o.tab === 'string' && o.tab.length <= 32) draft.tab = o.tab;
    return draft;
  } catch {
    return null;
  }
}

/** o que já está na memória: rascunho, null (não tem) ou undefined (ainda não lido) */
export function peekAvatarDraft(userId: string): AvatarDraft | null | undefined {
  return memory.has(userId) ? memory.get(userId) ?? null : undefined;
}

export async function loadAvatarDraft(userId: string, now = Date.now()): Promise<AvatarDraft | null> {
  const known = peekAvatarDraft(userId);
  if (known !== undefined) return known;
  let draft: AvatarDraft | null = null;
  try {
    draft = decodeAvatarDraft(await storage.get(avatarDraftKey(userId)), now);
  } catch {
    draft = null; // sem storage: segue sem rascunho
  }
  // alguém gravou enquanto a leitura rolava: vale o mais novo
  if (!memory.has(userId)) memory.set(userId, draft);
  return memory.get(userId) ?? null;
}

/** guarda já na memória; o aparelho grava em seguida (falha de gravação não quebra o editor) */
export function saveAvatarDraft(userId: string, config: AvatarConfig, tab?: string, now = Date.now()): Promise<void> {
  const draft: AvatarDraft = { config, at: now };
  if (tab) draft.tab = tab;
  memory.set(userId, draft);
  return storage.set(avatarDraftKey(userId), encodeAvatarDraft(draft)).catch(() => undefined);
}

export function clearAvatarDraft(userId: string): Promise<void> {
  memory.set(userId, null);
  return storage.del(avatarDraftKey(userId)).catch(() => undefined);
}
