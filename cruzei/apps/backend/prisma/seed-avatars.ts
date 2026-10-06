// Avatares dos fakes do seed-dev: pessoas diferentes (rosto, corpo, pele, cabelo e idade aparente) com roupa por
// estilo, pets, veículos, objetos, auras e fundos pagos só pra quem é Premium. Pronomes e orgulho aparecem em alguns,
// sorteados (voluntário): nunca deduzidos da orientação ou da aparência; pronomes só dentro do gênero declarado.
// Determinístico pela seed (telefone): o mesmo fake sai igual a cada execução (o cache do mapa não se refaz à toa).
import { createHash } from 'node:crypto';

import type { AvatarConfig, AvatarSlot, AvatarTier, Gender } from '@cruzei/shared-types';
import {
  applyLook,
  AVATAR_LOOK_SLOTS,
  AVATAR_LOOKS,
  avatarLookTier,
  avatarSlotDef,
  avatarTiersFor,
  DEFAULT_AVATAR,
  normalizeAvatarConfig,
  petPosesOf,
  randomAvatarConfig,
} from '@cruzei/shared-utils';

export interface DemoAvatarInput {
  /** seed estável (telefone do fake) */
  seed: string;
  gender: string;
  tier?: 'premium' | 'premium_plus';
  /** idade: marcas do tempo e grisalho */
  age: number;
  /** escolhas fixas (fakes nomeados): sem sorteio de estilo, só a identidade sorteada por baixo */
  avatar?: Partial<AvatarConfig>;
}

const PRONOUNS: Record<string, string[]> = {
  female: ['ela', 'ela', 'ela_elu', 'any'],
  male: ['ele', 'ele', 'ele_elu', 'any'],
  other: ['elu', 'ela_ele', 'ela_elu', 'ele_elu', 'any'],
};
const GRAY = ['h_silver', 'h_salt', 'h_gray', 'h_white'];
/** slots de estilo (os do look pronto) no padrão */
const STYLE_RESET = Object.fromEntries(AVATAR_LOOK_SLOTS.map((s) => [s, DEFAULT_AVATAR[s]]));

export function demoAvatar(p: DemoAvatarInput): AvatarConfig {
  const tiers = avatarTiersFor(p.tier ?? 'free');
  const paid = tiers.has('premium');
  let n = 0;
  const rnd = () =>
    createHash('sha256').update(`${p.seed}#${n++}`).digest().readUInt32BE(0) / 2 ** 32;
  const chance = (x: number) => rnd() < x;
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)];
  /** ids do slot liberados pro plano, sem o 'none'; `only` restringe os tiers (ex.: só os pagos) */
  const ids = (slot: AvatarSlot, only?: AvatarTier[]) =>
    (avatarSlotDef(slot).items as { id: string; tier: AvatarTier }[])
      .filter((i) => i.id !== 'none' && tiers.has(i.tier) && (!only || only.includes(i.tier)))
      .map((i) => i.id);

  // identidade: os campos antigos do sorteio de sempre + rosto, corpo, pele, cabelo e idade
  const base = randomAvatarConfig(p.seed, { gender: p.gender as Gender });
  const cfg: Record<string, unknown> = {
    ...base,
    faceShape: pick(ids('faceShape')),
    eyes: pick(ids('eyes')),
    brows: pick(ids('brows')),
    nose: pick(ids('nose')),
    eyeColor: chance(0.55) ? pick(['e_dark', 'e_brown']) : pick(ids('eyeColor', ['free'])),
  };
  if (chance(0.45)) cfg.body = pick(ids('body'));
  if (chance(0.45)) cfg.skin = pick(ids('skin', ['free']));
  if (chance(0.4)) cfg.hair = pick(ids('hair', ['free']));
  if (base.facialHair !== 'none' && chance(0.5)) cfg.facialHair = pick(ids('facialHair'));
  if (chance(0.25)) cfg.faceDetail = pick(ids('faceDetail', ['free']));
  cfg.lines = p.age >= 55 ? 'marked' : p.age >= 42 ? 'soft' : 'none';
  if (p.age >= 48 && chance(0.7)) cfg.hairColor = pick(GRAY);
  else if (paid && chance(0.3)) cfg.hairColor = pick(ids('hairColor', ['premium']));

  // visual escolhido: as peças sorteadas (chapéu, bolsa, pulso…) saem, fica só o que foi escolhido
  if (p.avatar) return normalizeAvatarConfig({ ...cfg, ...STYLE_RESET, ...p.avatar }, tiers);

  // estilo: look pronto do plano (casual, elegante, urbano, praia, festa, fantasia…) ou a roupa sorteada + sobreposição
  let out = normalizeAvatarConfig(cfg, tiers);
  const cloth = ids('topColor', ['free']);
  if (chance(0.5)) {
    const looks = AVATAR_LOOKS.filter((l) => tiers.has(avatarLookTier(l.id)));
    out = applyLook(out, pick(looks).id, tiers);
    // mesmas peças, outras cores: o look não vira uniforme no mapa
    if (chance(0.6)) out = { ...out, topColor: pick(cloth), outerColor: pick(cloth) };
  } else {
    if (chance(0.5)) out = { ...out, top: pick(ids('top', ['free'])), topColor: pick(cloth) };
    if (chance(0.4)) out = { ...out, outer: pick(ids('outer', ['free'])), outerColor: pick(cloth) };
    if (chance(0.3)) out = { ...out, bottom: pick(ids('bottom', ['free'])) };
    if (chance(0.3)) out = { ...out, shoes: pick(ids('shoes', ['free'])) };
  }
  const extra: Partial<Record<AvatarSlot, string>> = {};
  if (chance(paid ? 0.6 : 0.35)) {
    extra.pet = pick(paid && chance(0.6) ? ids('pet', ['premium', 'plus']) : ids('pet', ['free']));
    extra.petPose = pick(petPosesOf(extra.pet));
  }
  if (chance(0.05)) extra.vehicle = pick(['wheelchair', 'wheelchair_sport']);
  else if (chance(paid ? 0.35 : 0.15))
    extra.vehicle = pick(ids('vehicle').filter((v) => !v.startsWith('wheelchair')));
  if (extra.vehicle) extra.vehicleColor = pick(ids('vehicleColor', ['free']));
  if (chance(0.3)) extra.held = pick(ids('held'));
  if (chance(0.04)) extra.hat = pick(['hijab', 'turban']);
  if (chance(0.04)) extra.accessory = 'hearing_aid';
  if (chance(0.25)) extra.backdrop = pick(ids('backdrop'));
  if (chance(0.3)) extra.emote = pick(ids('emote'));
  if (paid) {
    extra.aura = tiers.has('plus') && chance(0.4) ? 'supernova' : pick(ids('aura', ['premium']));
    extra.auraColor = chance(0.5) ? 'a_auto' : pick(ids('auraColor'));
    extra.auraLevel = pick(ids('auraLevel'));
  } else if (chance(0.15)) {
    extra.aura = 'sparkle';
  }
  if (chance(0.25)) extra.pronouns = pick(PRONOUNS[p.gender] ?? PRONOUNS.other);
  if (chance(0.12)) {
    extra.pride = pick(ids('pride'));
    extra.prideFlag = pick(ids('prideFlag'));
  }
  return normalizeAvatarConfig({ ...out, ...extra }, tiers);
}
