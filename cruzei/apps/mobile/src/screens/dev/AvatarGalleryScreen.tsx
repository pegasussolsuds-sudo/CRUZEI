// Galeria de desenvolvimento do avatar (só existe em __DEV__): mostra cada item do catálogo com os renderizadores
// REAIS do aparelho — SVG das listas (CruzeiAvatar), palco Skia (AvatarStage) e o raster do mapa (mapDraw.figure) —
// pra revisar no celular o que a folha de contato do computador não garante (react-native-svg e Skia de verdade).
//
// Abre por link (adb):  adb shell am start -a android.intent.action.VIEW -d "metch://dev/avatar-gallery?slot=hat&mode=tiles&page=0&p=0" app.metch
//   slot  = slot do catálogo (hair, top, hat, pet, vehicle, aura, emote…) ou 'looks'
//   mode  = tiles (corpo inteiro, 12 por página) · bust (miniatura 56 px) · map (raster do mapa em tamanho real) · stage (palco grande)
//   page  = página (12 itens por página)       p = pessoa base 0..2       id = item (só no modo stage)

import type { AvatarConfig, AvatarItemSlot } from '@cruzei/shared-types';
import { AVATAR_ITEM_SLOTS, AVATAR_LOOKS, DEFAULT_AVATAR, applyLook, normalizeAvatarConfig } from '@cruzei/shared-utils';
import { colors } from '@cruzei/ui-mobile';
import { useRoute, type RouteProp } from '@react-navigation/native';
import React, { useMemo } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';


import { emoteDef } from '../../avatar/emotes';
import { CruzeiAvatar } from '../../components/avatar/CruzeiAvatar';
import { AvatarStage } from '../../components/avatar/stage';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { IMG } from '../map/native/contracts';
import { mapDraw } from '../map/native/images/draw';
import { mapAvatarDef } from '../map/native/images/mapAvatar';
import { bytesToBase64 } from '../moderation/imageDataUri';

type GalleryMode = 'tiles' | 'bust' | 'map' | 'stage';
type Route = RouteProp<RootStackParamList, 'AvatarGallery'>;

const PER_PAGE = 12;

/** três pessoas bem diferentes pra conferir encaixe em corpos, rostos e cabelos variados */
const PEOPLE: Partial<AvatarConfig>[] = [
  { body: 'regular', skin: 's3', faceShape: 'oval', hair: 'short', hairColor: 'h_dark', top: 'tee', topColor: 'c_white', bottom: 'jeans' },
  { body: 'plus', skin: 's7', faceShape: 'round', eyes: 'round', hair: 'afro', hairColor: 'h_black', top: 'tee', topColor: 'c_coral', bottom: 'pants', bottomColor: 'c_black' },
  { body: 'curvy', skin: 's9', faceShape: 'heart', eyes: 'upturned', hair: 'long', hairColor: 'h_blonde', top: 'tee', topColor: 'c_teal', bottom: 'jeans', lines: 'soft' },
];

function personConfig(p: number, patch: Partial<AvatarConfig> = {}): AvatarConfig {
  return normalizeAvatarConfig({ ...DEFAULT_AVATAR, ...PEOPLE[Math.abs(p) % PEOPLE.length], ...patch });
}

interface GalleryItem {
  id: string;
  label: string;
  config: AvatarConfig;
  emote?: string;
}

function itemsFor(slot: string, p: number): GalleryItem[] {
  if (slot === 'looks') {
    return AVATAR_LOOKS.map((l) => ({ id: l.id, label: l.label, config: applyLook(personConfig(p), l.id) }));
  }
  const def = AVATAR_ITEM_SLOTS.find((s) => s.slot === slot);
  if (!def) return [];
  return def.items.map((it) => {
    const patch: Partial<AvatarConfig> = { [def.slot as AvatarItemSlot]: it.id };
    // itens que só aparecem com outro: pronomes/bandeira precisam de um item de orgulho visível, posição precisa de pet
    if (slot === 'prideFlag') patch.pride = 'pin';
    if (slot === 'petPose') patch.pet = 'cat_orange';
    if (slot === 'auraLevel') patch.aura = 'flames';
    if (slot === 'emote') return { id: it.id, label: it.label, config: personConfig(p), emote: it.id === 'none' ? undefined : it.id };
    return { id: it.id, label: it.label, config: personConfig(p, patch) };
  });
}

/** PNG do raster do mapa → data URI (mesma montagem de figura que o MapScreen manda pro motor) */
function mapFigureUri(cfg: AvatarConfig): string | null {
  try {
    const def = mapAvatarDef(cfg);
    const look = { recent: true, boosted: false, premiumTier: 'premium' as const, verified: false, aura: cfg.aura === 'none' ? '' : cfg.aura, anonymous: false };
    const bytes = mapDraw.figure(def as never, look as never, IMG.fig, null, false);
    return bytes ? `data:image/png;base64,${bytesToBase64(bytes)}` : null;
  } catch {
    return null;
  }
}

function emotePose(id: string | undefined) {
  if (!id) return undefined;
  const def = emoteDef(id);
  if (!def) return undefined;
  const k = def.keyK ?? 0.5;
  return def.pose(k, k * def.dur, { ph: 0, sp: 1, en: 1 });
}

export function AvatarGalleryScreen() {
  const { params } = useRoute<Route>();
  const slot = params?.slot ?? 'hair';
  const mode: GalleryMode = (params?.mode as GalleryMode) ?? 'tiles';
  const page = Math.max(0, Number(params?.page ?? 0) || 0);
  const p = Number(params?.p ?? 0) || 0;
  const all = useMemo(() => itemsFor(slot, p), [slot, p]);
  const pages = Math.max(1, Math.ceil(all.length / PER_PAGE));
  const slice = all.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
  const header = `${slot} · ${mode} · pág ${page + 1}/${pages} · pessoa ${p} · ${all.length} itens`;

  if (mode === 'stage') {
    const it = all.find((i) => i.id === params?.id) ?? slice[0];
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <Text style={styles.header}>{`${slot} · palco · ${it ? it.label : '—'}`}</Text>
        {it ? (
          <View style={styles.stageWrap}>
            <AvatarStage
              config={it.config}
              size={520}
              mode="full"
              emote={it.emote ?? null}
              playing
              loop
              idle
              showBackdrop
              showPronouns
              groundShadow
              accessibilityLabel={it.label}
            />
          </View>
        ) : null}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <Text style={styles.header}>{header}</Text>
      <ScrollView contentContainerStyle={styles.grid}>
        {slice.map((it) => {
          const uri = mode === 'map' ? mapFigureUri(it.config) : null;
          return (
            <View key={it.id} style={mode === 'map' ? styles.cellMap : mode === 'bust' ? styles.cellBust : styles.cell}>
              {mode === 'map' ? (
                uri ? <Image source={{ uri }} style={styles.mapImg} /> : <Text style={styles.err}>sem figura</Text>
              ) : mode === 'bust' ? (
                <CruzeiAvatar config={it.config} mode="bust" size={56} backgroundColor="#1A1A2E" accessibilityLabel={it.label} />
              ) : (
                <CruzeiAvatar config={it.config} mode="full" size={150} groundShadow pose={emotePose(it.emote) as never} accessibilityLabel={it.label} />
              )}
              <Text style={styles.label} numberOfLines={1}>
                {it.label}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black },
  header: { color: colors.white, fontSize: 13, paddingHorizontal: 10, paddingVertical: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 4 },
  cell: { width: '33.3%', alignItems: 'center', paddingVertical: 2 },
  cellBust: { width: '25%', alignItems: 'center', paddingVertical: 8 },
  cellMap: { width: '25%', alignItems: 'center', paddingVertical: 6, backgroundColor: '#2B3140' },
  mapImg: { width: IMG.fig.w, height: IMG.fig.h },
  label: { color: 'rgba(250,250,250,0.75)', fontSize: 10, maxWidth: '95%' },
  err: { color: colors.danger, fontSize: 10, height: IMG.fig.h },
  stageWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
