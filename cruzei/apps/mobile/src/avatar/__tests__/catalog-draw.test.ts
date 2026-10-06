// Integração: TODO id do catálogo desenha algo próprio (nenhum cai no desenho de outro, no 'none' ou num placeholder)
// e nenhum lança erro ou gera número inválido, no completo e no leve.

import type { AvatarConfig, AvatarItemSlot } from '@cruzei/shared-types';
import { AVATAR_ITEM_SLOTS, DEFAULT_AVATAR, normalizeAvatarConfig } from '@cruzei/shared-utils';

import { buildAvatarLayers } from '../layers';

/** slots que não viram camada do avatar (palco, placa de pronomes, animação) */
const NOT_LAYERED = new Set<AvatarItemSlot>(['pronouns', 'aura', 'auraLevel', 'backdrop', 'emote', 'petPose']);
/** o que o slot precisa pra aparecer (calçado com perna de fora: com calça comprida o cano alto fica por baixo da barra) */
const NEEDS: Partial<Record<AvatarItemSlot, Partial<AvatarConfig>>> = { prideFlag: { pride: 'sash' }, shoes: { bottom: 'shorts' } };
const BAD = /NaN|Infinity|undefined/;

const base = normalizeAvatarConfig(DEFAULT_AVATAR) as AvatarConfig;

describe('catálogo inteiro desenha', () => {
  it.each(AVATAR_ITEM_SLOTS.map((s) => [s.slot as AvatarItemSlot, s.items.map((i) => i.id)] as const))('slot %s', (slot, ids) => {
    const sig = new Map<string, string>();
    for (const id of ids) {
      const cfg = { ...base, ...NEEDS[slot], [slot]: id } as AvatarConfig;
      const full = buildAvatarLayers(cfg, { groundShadow: true });
      const lite = buildAvatarLayers(cfg, { groundShadow: true, lod: 'lite' });
      for (const l of [...full, ...lite]) {
        if (BAD.test(l.d) || (l.cp != null && BAD.test(l.cp))) throw new Error(`${slot}=${id}: path inválido`);
      }
      sig.set(id, JSON.stringify(full));
    }
    if (NOT_LAYERED.has(slot)) return;
    // cada id é um desenho diferente dos outros do slot (inclusive do 'none')
    const seen = new Map<string, string>();
    for (const [id, s] of sig) {
      const dup = seen.get(s);
      if (dup) throw new Error(`${slot}: '${id}' desenha igual a '${dup}'`);
      seen.set(s, id);
    }
  });
});
