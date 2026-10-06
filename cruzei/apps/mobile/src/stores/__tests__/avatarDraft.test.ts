import type { AvatarConfig } from '@cruzei/shared-types';
import { DEFAULT_AVATAR, normalizeAvatarConfig } from '@cruzei/shared-utils';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

import {
  AVATAR_DRAFT_MAX_AGE_MS,
  avatarDraftKey,
  clearAvatarDraft,
  decodeAvatarDraft,
  encodeAvatarDraft,
  loadAvatarDraft,
  peekAvatarDraft,
  saveAvatarDraft,
  setAvatarDraftStorage,
  type AvatarDraftStorage,
} from '../avatarDraft';

const base = normalizeAvatarConfig(DEFAULT_AVATAR);
const NOW = 1_800_000_000_000;

function memStorage(seed: Record<string, string> = {}): AvatarDraftStorage & { data: Record<string, string> } {
  const data = { ...seed };
  return {
    data,
    get: async (k) => data[k] ?? null,
    set: async (k, v) => {
      data[k] = v;
    },
    del: async (k) => {
      delete data[k];
    },
  };
}

describe('avatarDraft: codificação', () => {
  it('ida e volta mantém config (inclusive item bloqueado experimentado) e aba', () => {
    const cfg: AvatarConfig = { ...base, top: 'tux', aura: 'supernova', vehicle: 'ufo' };
    const back = decodeAvatarDraft(encodeAvatarDraft({ config: cfg, tab: 'top', at: NOW }), NOW);
    expect(back).toEqual({ config: cfg, tab: 'top', at: NOW });
  });

  it('descarta vazio, lixo, versão errada, velho demais e do futuro', () => {
    expect(decodeAvatarDraft(null, NOW)).toBeNull();
    expect(decodeAvatarDraft('{oops', NOW)).toBeNull();
    expect(decodeAvatarDraft(JSON.stringify({ v: 2, at: NOW, config: base }), NOW)).toBeNull();
    expect(decodeAvatarDraft(JSON.stringify({ v: 1, at: NOW, config: null }), NOW)).toBeNull();
    expect(decodeAvatarDraft(encodeAvatarDraft({ config: base, at: NOW - AVATAR_DRAFT_MAX_AGE_MS - 1 }), NOW)).toBeNull();
    expect(decodeAvatarDraft(encodeAvatarDraft({ config: base, at: NOW + 3_600_000 }), NOW)).toBeNull();
  });

  it('normaliza config antiga/estranha (id desconhecido vira o padrão, colar migra pro pescoço)', () => {
    const raw = JSON.stringify({ v: 1, at: NOW, config: { ...base, hair: 'nao-existe', accessory: 'necklace', neck: 'none' } });
    const d = decodeAvatarDraft(raw, NOW)!;
    expect(d.config.hair).toBe(DEFAULT_AVATAR.hair);
    expect(d.config.neck).toBe('necklace');
    expect(d.config.accessory).toBe('none');
  });

  it('chave do SecureStore só com caracteres aceitos', () => {
    expect(avatarDraftKey('abc-123_x.y')).toBe('metch.avatarDraft.v1.abc-123_x.y');
    expect(avatarDraftKey('a b/c@d')).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('cabe folgado no limite do SecureStore (2 KB) mesmo com a maior config', () => {
    const big: AvatarConfig = { ...base };
    for (const k of Object.keys(big) as (keyof AvatarConfig)[]) if (k !== 'v') (big as unknown as Record<string, string>)[k] = 'xxxxxxxxxxxxxxxx';
    expect(encodeAvatarDraft({ config: big, tab: 'vehicleColor', at: NOW }).length).toBeLessThan(2048);
  });
});

describe('avatarDraft: guardar, ler e apagar', () => {
  it('memória responde na hora; aparelho guarda; apagar some dos dois', async () => {
    const st = memStorage();
    setAvatarDraftStorage(st);
    expect(peekAvatarDraft('u1')).toBeUndefined();
    const cfg = { ...base, hair: 'afro' };
    await saveAvatarDraft('u1', cfg, 'hair', NOW);
    expect(peekAvatarDraft('u1')?.config.hair).toBe('afro');
    expect(st.data[avatarDraftKey('u1')]).toBeDefined();
    await clearAvatarDraft('u1');
    expect(peekAvatarDraft('u1')).toBeNull();
    expect(st.data[avatarDraftKey('u1')]).toBeUndefined();
  });

  it('app frio: lê do aparelho uma vez e guarda na memória; contas não se misturam', async () => {
    const st = memStorage({ [avatarDraftKey('u2')]: encodeAvatarDraft({ config: { ...base, top: 'gown' }, tab: 'top', at: NOW }) });
    const get = jest.spyOn(st, 'get');
    setAvatarDraftStorage(st);
    const d = await loadAvatarDraft('u2', NOW);
    expect(d?.config.top).toBe('gown');
    expect(d?.tab).toBe('top');
    await loadAvatarDraft('u2', NOW);
    expect(get).toHaveBeenCalledTimes(1);
    expect(await loadAvatarDraft('u3', NOW)).toBeNull();
    expect(peekAvatarDraft('u3')).toBeNull();
  });

  it('gravação durante a leitura vale mais que o que estava no aparelho', async () => {
    let release: (v: string | null) => void = () => undefined;
    const st = memStorage();
    st.get = () => new Promise((r) => (release = r));
    setAvatarDraftStorage(st);
    const pending = loadAvatarDraft('u4', NOW);
    void saveAvatarDraft('u4', { ...base, hair: 'bob' }, undefined, NOW);
    release(encodeAvatarDraft({ config: { ...base, hair: 'long' }, at: NOW - 1000 }));
    expect((await pending)?.config.hair).toBe('bob');
  });

  it('armazenamento quebrado não derruba o editor', async () => {
    setAvatarDraftStorage({
      get: async () => {
        throw new Error('keystore');
      },
      set: async () => {
        throw new Error('keystore');
      },
      del: async () => {
        throw new Error('keystore');
      },
    });
    await expect(loadAvatarDraft('u5', NOW)).resolves.toBeNull();
    await expect(saveAvatarDraft('u5', base, undefined, NOW)).resolves.toBeUndefined();
    expect(peekAvatarDraft('u5')?.config).toEqual(base);
    await expect(clearAvatarDraft('u5')).resolves.toBeUndefined();
  });
});
