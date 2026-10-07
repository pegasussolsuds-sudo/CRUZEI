/* eslint-disable no-console */
// Folha de contato do avatar: renderiza grades de avatares em PNG (SVG → sharp) com o MESMO buildAvatarLayers,
// o mesmo modelo SVG do <CruzeiAvatar/> (avatar/svgModel.ts) e a mesma matemática de pose (avatar/rig.ts).
// Serve pra conferir e iterar o desenho: gere, ABRA o PNG (ferramenta Read) e olhe de verdade.
//
// COMANDO (rodar dentro de apps/mobile, no git-bash; ts-node da raiz, só transpila):
//   npx ts-node -T --skipProject -O '{"module":"node16","moduleResolution":"node16","target":"es2022","esModuleInterop":true,"jsx":"react"}' scripts/avatar-sheet.ts [opções]
// (atalho: S="npx ts-node -T --skipProject -O '{...}' scripts/avatar-sheet.ts"; os exemplos abaixo começam com "...")
// Mais rápido (empacotado com esbuild da raiz, sem transpilar a cada vez):
//   ../../node_modules/.bin/esbuild scripts/avatar-sheet.ts --bundle --platform=node --outfile=/tmp/sheet.js \
//     --external:sharp --external:canvaskit-wasm '--external:@shopify/*' --external:react-native '--external:react-native-*' --log-level=error
//   NODE_PATH="../../node_modules:./node_modules" node /tmp/sheet.js [opções]
// Cada célula vira um PNG separado (em paralelo) e a folha é composta no fim: o desfoque de verdade no sharp é caro
// num SVG gigante, por célula fica linear.
//
// Exemplos:
//   ... scripts/avatar-sheet.ts --set legacy --label --out /tmp/legado.png        (12 configs antigas congeladas)
//   ... scripts/avatar-sheet.ts --slot hair --label --out cabelos.png              (todos os cabelos sobre a base)
//   ... scripts/avatar-sheet.ts --slot hair --mode bust --size 56 --out cab56.png  (miniatura de lista)
//   ... scripts/avatar-sheet.ts --base default --size 48 --cols 10 --slot top      (tamanho de mapa)
//   ... scripts/avatar-sheet.ts --config '{"hair":"afro","facialHair":"beard"}' --pose wave --out x.png
//   ... scripts/avatar-sheet.ts --emote wave --frames 8 --out tira.png             (tira de quadros; aceita os
//         estados do mapa idle/walk/run/wave/like/celebrate/match/arrive e os ids do registro de emotes)
//   ... scripts/avatar-sheet.ts --demo infra --out demo.png                         (prova gradiente/recorte/desfoque/tracejado/juntas)
//   ... scripts/avatar-sheet.ts --diff a.png b.png --out diff.png                   (compara dois PNGs pixel a pixel)
//   ... scripts/avatar-sheet.ts --set legacy --renderer all --label --out tres.png  (SVG × mapa × palco)
//
// Opções:
//   --slot <slot>          todos os itens (ou cores) de um slot do catálogo sobre a config base
//   --config '<json>'      config parcial (pode repetir: uma célula por --config)
//   --configs <arq.json>   lista de configs parciais ou de { label, config, pose?, emote?, k? } (pode repetir)
//   --base <preset>        default | dress | afro | gear | scarf | neon | r1..r6 | random:<semente>  (padrão: default)
//   --set legacy           as 12 configs antigas congeladas (linha de base do redesenho)
//   --set hero|people|bodies|faces|expressions|mature|details|rests|poses|samehair|seated   provas visuais do corpo
//                          novo (presets do diretor de arte, ver ART_SETS); poses paradas extras: hello | hip | dance |
//                          dance2 | bend | cheer (ART_POSES, partem do braço solto de cada pessoa; células com
//                          `hands: { R: 'open' }` desenham a mão aberta com a palma pra câmera)
//   --emote <id>           tira de quadros da animação (com --frames N, padrão 8)
//   --pose <nome>          pose parada: zero | wave | celebrate | like | match | arrive | walk | run | tpose | bend | reach
//   --mode full|bust       corpo inteiro (padrão) ou busto
//   --size <px>            altura da célula (padrão 220 full / 120 bust); mapa ≈ 48, miniatura ≈ 56 bust
//   --bg dark|light        fundo (padrão dark #0A0A1A)
//   --cols <n>             colunas (padrão: até 6)
//   --label                escreve o rótulo embaixo de cada célula
//   --lite                 nível de detalhe leve (o que listas e miniaturas ≤ 100 px desenham)
//   --micro                + o filtro da miniatura ≤ 56 px do <CruzeiAvatar/> (svgModel.microLayers)
//   --blur filter|approx|half   desfoque no SVG (padrão filter = igual ao Skia; approx = o que as listas mostram)
//   --raw                  não normaliza as configs (padrão: normaliza como o app)
//   --shadow               desenha a sombra no chão (padrão: liga no full)
//   --renderer svg|map|stage|all   quem desenha: svg (padrão; = <CruzeiAvatar/> via sharp), map (o raster do mapa de
//                          verdade: images/draw.ts mapDraw.figure, Skia/CanvasKit de CPU), stage (as SkPictures do palco
//                          animado: stage/assets.ts + matrizes do rig) ou all (as três, uma linha por renderer)
//   --tier <plano>         (renderer map) anel do plano: free (padrão) | premium | premium_plus
//   --aura                 (renderer map) poça de luz na cor da aura da config, como o motor faz
//   --out <arq.png>        saída (padrão ./avatar-sheet.png)

import * as fs from 'fs';
import * as path from 'path';

import type { AvatarConfig } from '@cruzei/shared-types';
import * as SU from '@cruzei/shared-utils';

import { buildAnatomy, restArmDelta } from '../src/avatar/anatomy';
import { emoteDef, emoteFaceAt, emoteHands } from '../src/avatar/emotes';
import { circle, ellipse, rrect } from '../src/avatar/geometry';
import { AVATAR_VIEWBOX, buildAvatarLayers, buildAvatarRig, bustBoxFor, layersWithTag } from '../src/avatar/layers';
import { NEUTRAL_VARIATION, clonePose, zero, type Pose } from '../src/avatar/pose';
import { applyScene, propConfig, propFreesHands } from '../src/avatar/scene';
import { buildSvgModel, microLayers, svgModelToString, type SvgBlurMode } from '../src/avatar/svgModel';
import type { AvatarLayer, AvatarRig } from '../src/avatar/types';
import * as anim from '../src/screens/map/native/images/anim';

// sharp vem do node_modules da raiz (não é dependência do app)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sharp = require('sharp');

// ---------------------------------------------------------------------------------------------------------------
// argumentos
// ---------------------------------------------------------------------------------------------------------------
interface Args {
  slot?: string;
  configs: Partial<AvatarConfig>[];
  configsFiles: string[];
  base: string;
  set?: string;
  emote?: string;
  frames: number;
  pose?: string;
  mode: 'full' | 'bust';
  size?: number;
  bg: 'dark' | 'light';
  cols?: number;
  label: boolean;
  blur: SvgBlurMode;
  raw: boolean;
  shadow?: boolean;
  out: string;
  demo?: string;
  diff?: [string, string];
  renderer: 'svg' | 'map' | 'stage' | 'all';
  /** nível de detalhe leve (lista/miniatura ≤ 100 px) no renderer svg */
  lite: boolean;
  micro?: boolean;
  /** renderer map: plano do anel (free | premium | premium_plus) */
  tier?: string;
  /** renderer map: poça de luz na cor da aura da config (mapAuraRgb) */
  mapAura?: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { configs: [], configsFiles: [], base: 'default', frames: 8, mode: 'full', bg: 'dark', label: false, blur: 'filter', raw: false, out: 'avatar-sheet.png', renderer: 'svg', lite: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => {
      const x = argv[++i];
      if (x === undefined) throw new Error(`faltou o valor de ${k}`);
      return x;
    };
    switch (k) {
      case '--slot':
        a.slot = v();
        break;
      case '--config':
        a.configs.push(JSON.parse(v()));
        break;
      case '--configs':
        a.configsFiles.push(v());
        break;
      case '--base':
        a.base = v();
        break;
      case '--set':
        a.set = v();
        break;
      case '--emote':
        a.emote = v();
        break;
      case '--frames':
        a.frames = Math.max(1, parseInt(v(), 10));
        break;
      case '--pose':
        a.pose = v();
        break;
      case '--mode':
        a.mode = v() === 'bust' ? 'bust' : 'full';
        break;
      case '--size':
        a.size = parseInt(v(), 10);
        break;
      case '--bg':
        a.bg = v() === 'light' ? 'light' : 'dark';
        break;
      case '--cols':
        a.cols = parseInt(v(), 10);
        break;
      case '--label':
        a.label = true;
        break;
      case '--tier':
        a.tier = v();
        break;
      case '--aura':
        a.mapAura = true;
        break;
      case '--lite':
        a.lite = true;
        break;
      case '--micro':
        a.micro = true;
        break;
      case '--blur':
        a.blur = v() as SvgBlurMode;
        break;
      case '--raw':
        a.raw = true;
        break;
      case '--shadow':
        a.shadow = true;
        break;
      case '--no-shadow':
        a.shadow = false;
        break;
      case '--out':
        a.out = v();
        break;
      case '--demo':
        a.demo = v();
        break;
      case '--diff':
        a.diff = [v(), v()];
        break;
      case '--renderer': {
        const r = v();
        if (r !== 'svg' && r !== 'map' && r !== 'stage' && r !== 'all') throw new Error(`renderer desconhecido: ${r}`);
        a.renderer = r;
        break;
      }
      default:
        throw new Error(`opção desconhecida: ${k}`);
    }
  }
  return a;
}

// ---------------------------------------------------------------------------------------------------------------
// configs: presets e o conjunto legado congelado
// ---------------------------------------------------------------------------------------------------------------
const DEFAULT_LEGACY: AvatarConfig = {
  ...(SU.DEFAULT_AVATAR as AvatarConfig),
};

/** as 12 configs antigas da linha de base (congeladas em 05/10/2026 a partir do randomAvatarConfig da época) */
export const LEGACY_SET: { label: string; config: Partial<AvatarConfig> }[] = [
  { label: 'padrão', config: {} },
  { label: 'r1', config: { body: 'broad', skin: 's5', hair: 'long', hairColor: 'h_gray', face: 'wink', top: 'shirt', topColor: 'c_olive', bottom: 'skirt', bottomColor: 'c_gray', shoes: 'sneakers', shoesColor: 'c_beige', hatColor: 'c_white', accessory: 'headphones', bag: 'backpack', wrist: 'bracelet' } },
  { label: 'r2', config: { body: 'broad', skin: 's6', hair: 'curly', hairColor: 'h_auburn', face: 'laugh', top: 'hoodie', topColor: 'c_teal', bottom: 'jeans', bottomColor: 'c_beige', shoes: 'sandals', shoesColor: 'c_black', hatColor: 'c_olive', bag: 'backpack', wrist: 'watch' } },
  { label: 'r3', config: { body: 'slim', skin: 's3', hair: 'long', hairColor: 'h_blonde', face: 'calm', top: 'polo', topColor: 'c_pink', bottom: 'shorts', bottomColor: 'c_beige', shoes: 'sandals', shoesColor: 'c_gray', hat: 'cap_back', hatColor: 'c_brown', glasses: 'round', wrist: 'bracelet' } },
  { label: 'r4', config: { body: 'regular', skin: 's3', hair: 'wavy', hairColor: 'h_light', face: 'laugh', top: 'tank', topColor: 'c_purple', bottom: 'shorts', bottomColor: 'c_gray', shoes: 'boots', shoesColor: 'c_white', glasses: 'square', accessory: 'flower', wrist: 'bracelet' } },
  { label: 'r5', config: { body: 'broad', skin: 's2', hair: 'buzz', hairColor: 'h_red', face: 'cool', top: 'tank', topColor: 'c_orange', bottom: 'pants', bottomColor: 'c_beige', shoes: 'boots', shoesColor: 'c_red', hatColor: 'c_white', bag: 'crossbody' } },
  { label: 'r6', config: { body: 'regular', skin: 's8', hair: 'bun', hairColor: 'h_black', face: 'laugh', top: 'shirt', topColor: 'c_pink', bottom: 'pants', bottomColor: 'c_gray', shoes: 'sneakers', shoesColor: 'c_beige', hatColor: 'c_olive', wrist: 'bracelet' } },
  { label: 'chapéu+óculos+fone', config: { hat: 'cap', hatColor: 'c_red', glasses: 'square', accessory: 'headphones' } },
  { label: 'vestido', config: { top: 'dress', topColor: 'c_red', hair: 'long', hairColor: 'h_brown', shoes: 'sandals', shoesColor: 'c_gold', skin: 's4', wrist: 'watch' } },
  { label: 'afro+barba', config: { hair: 'afro', hairColor: 'h_black', facialHair: 'beard', skin: 's7', top: 'sweater', topColor: 'c_yellow', bottom: 'joggers', bottomColor: 'c_black', shoes: 'hightops', shoesColor: 'c_red' } },
  { label: 'cachecol+jaqueta', config: { accessory: 'scarf', top: 'jacket', topColor: 'c_brown', hair: 'side', hairColor: 'h_blonde', facialHair: 'stubble', bottom: 'cargo', bottomColor: 'c_olive', shoes: 'boots', shoesColor: 'c_brown' } },
  { label: 'corrente+neon', config: { accessory: 'chain', top: 'neon_jacket', topColor: 'c_magenta', hair: 'mohawk', hairColor: 'h_pink', bottom: 'leggings', bottomColor: 'c_black', shoes: 'runners', shoesColor: 'c_black', glasses: 'visor', wrist: 'smartwatch', skin: 's1' } },
];

// ---------------------------------------------------------------------------------------------------------------
// presets do diretor de arte (conjuntos de prova visual do corpo novo). Só usam peças que já têm desenho no corpo
// novo: camiseta (o caimento varia por pessoa: justa/normal/solta/por dentro), jeans, tênis e os cabelos
// curto/longo/cacheado/black power/careca. O repouso também varia por pessoa (anatomy.restOf).
// ---------------------------------------------------------------------------------------------------------------
/**
 * célula de prova: `pose` = pose parada (ART_POSES partem do braço SOLTO de cada pessoa: a folha soma restArmDelta);
 * `hands` = mão aberta com a palma pra câmera nas poses de braço erguido (BuildOptions.hands, lido por parts/body.ts)
 */
type ArtCell = { label: string; config: Partial<AvatarConfig>; pose?: string; k?: number; hands?: { L?: 'open'; R?: 'open' } };

const LOOK_BASE: Partial<AvatarConfig> = { top: 'tee', bottom: 'jeans', shoes: 'sneakers' };

export const ART_SETS: Record<string, ArtCell[]> = {
  hero: [
    { label: 'Ana', config: { ...LOOK_BASE, body: 'curvy', skin: 's2', faceShape: 'heart', eyes: 'almond', eyeColor: 'e_hazel', brows: 'arched', nose: 'small', hair: 'long', hairColor: 'h_brown', face: 'smile', topColor: 'c_coral', bottomColor: 'c_lightdenim', shoesColor: 'c_white' } },
    { label: 'Kwame', config: { ...LOOK_BASE, body: 'athletic', skin: 's8', faceShape: 'square', eyes: 'round', eyeColor: 'e_dark', brows: 'thick', nose: 'wide', hair: 'afro', hairColor: 'h_black', face: 'grin', topColor: 'c_white', bottomColor: 'c_black', shoesColor: 'c_red' } },
    { label: 'Dona Lúcia', config: { ...LOOK_BASE, body: 'plus', skin: 's11', faceShape: 'round', eyes: 'hooded', eyeColor: 'e_brown', brows: 'thin', nose: 'aquiline', hair: 'short', hairColor: 'h_silver', lines: 'marked', face: 'smile', topColor: 'c_navy', bottomColor: 'c_beige', shoesColor: 'c_brown' } },
    { label: 'Theo', config: { ...LOOK_BASE, body: 'slim', skin: 's1', faceShape: 'diamond', eyes: 'upturned', eyeColor: 'e_green', brows: 'thick', nose: 'aquiline', hair: 'curly', hairColor: 'h_auburn', faceDetail: 'freckles', face: 'wink', topColor: 'c_teal', bottomColor: 'c_denim', shoesColor: 'c_navy' } },
  ],
  people: [
    { label: 'Mei', config: { ...LOOK_BASE, body: 'regular', skin: 's10', faceShape: 'oval', eyes: 'monolid', brows: 'straight', nose: 'soft', hair: 'short', hairColor: 'h_black', face: 'smile', topColor: 'c_red', bottomColor: 'c_denim' } },
    { label: 'Iara', config: { ...LOOK_BASE, body: 'slim', skin: 's13', faceShape: 'long', eyes: 'almond', brows: 'soft', nose: 'straight', hair: 'long', hairColor: 'h_black', face: 'calm', topColor: 'c_purple', bottomColor: 'c_black' } },
    { label: 'Seu Bento', config: { ...LOOK_BASE, body: 'broad', skin: 's14', faceShape: 'square', eyes: 'downturned', brows: 'bushy', nose: 'wide', hair: 'bald', hairColor: 'h_gray', lines: 'soft', face: 'laugh', topColor: 'c_yellow', bottomColor: 'c_denim' } },
    { label: 'Sofia', config: { ...LOOK_BASE, body: 'curvy', skin: 's9', faceShape: 'round', eyes: 'almond', eyeColor: 'e_blue', brows: 'soft', nose: 'straight', hair: 'curly', hairColor: 'h_blonde', face: 'smile', topColor: 'c_pink', bottomColor: 'c_lightdenim' } },
    { label: 'Dandara', config: { ...LOOK_BASE, body: 'plus', skin: 's6', faceShape: 'oval', eyes: 'hooded', brows: 'thick', nose: 'wide', hair: 'afro', hairColor: 'h_dark', face: 'grin', topColor: 'c_green', bottomColor: 'c_denim' } },
    { label: 'Vô Arthur', config: { ...LOOK_BASE, body: 'slim', skin: 's3', faceShape: 'long', eyes: 'hooded', eyeColor: 'e_gray', brows: 'thin', nose: 'aquiline', hair: 'short', hairColor: 'h_white', lines: 'marked', face: 'serene', topColor: 'c_beige', bottomColor: 'c_navy' } },
    { label: 'Nina', config: { ...LOOK_BASE, body: 'athletic', skin: 's1', faceShape: 'diamond', eyes: 'upturned', eyeColor: 'e_gray', brows: 'arched', nose: 'small', hair: 'long', hairColor: 'h_platinum', faceDetail: 'mole', face: 'smirk', topColor: 'c_navy', bottomColor: 'c_black' } },
    { label: 'Rafa', config: { ...LOOK_BASE, body: 'regular', skin: 's12', faceShape: 'heart', eyes: 'almond', brows: 'soft', nose: 'soft', hair: 'curly', hairColor: 'h_black', face: 'wink', topColor: 'c_orange', bottomColor: 'c_denim' } },
    { label: 'Caio', config: { ...LOOK_BASE, body: 'plus', skin: 's2', faceShape: 'square', eyes: 'hooded', eyeColor: 'e_amber', brows: 'thick', nose: 'soft', hair: 'short', hairColor: 'h_red', faceDetail: 'freckles', face: 'grin', topColor: 'c_teal', bottomColor: 'c_lightdenim' } },
    { label: 'Marta', config: { ...LOOK_BASE, body: 'curvy', skin: 's5', faceShape: 'oval', eyes: 'downturned', brows: 'soft', nose: 'straight', hair: 'long', hairColor: 'h_salt', lines: 'soft', face: 'smile', topColor: 'c_olive', bottomColor: 'c_denim' } },
    { label: 'Mestre Zé', config: { ...LOOK_BASE, body: 'regular', skin: 's7', faceShape: 'round', eyes: 'almond', brows: 'bushy', nose: 'wide', hair: 'afro', hairColor: 'h_silver', lines: 'marked', face: 'calm', topColor: 'c_white', bottomColor: 'c_black' } },
    { label: 'Jô', config: { ...LOOK_BASE, body: 'athletic', skin: 's8', faceShape: 'oval', eyes: 'almond', brows: 'thick', nose: 'soft', hair: 'bald', faceDetail: 'vitiligo', face: 'smile', topColor: 'c_coral', bottomColor: 'c_denim' } },
  ],
  bodies: (['slim', 'regular', 'broad', 'plus', 'curvy', 'athletic'] as const).map((body, i) => ({
    label: { slim: 'Esguio', regular: 'Médio', broad: 'Largo', plus: 'Plus size', curvy: 'Curvilíneo', athletic: 'Atlético' }[body],
    config: { ...LOOK_BASE, body, skin: ['s3', 's6', 's10', 's12', 's4', 's8'][i], hair: (['short', 'curly', 'short', 'long', 'long', 'afro'] as const)[i], hairColor: ['h_dark', 'h_black', 'h_brown', 'h_black', 'h_light', 'h_black'][i], topColor: 'c_gray', bottomColor: 'c_denim' },
  })),
  faces: [
    ['s9', 'oval', 'almond', 'soft', 'soft', 'long', 'h_blonde', 'e_blue'],
    ['s1', 'heart', 'upturned', 'arched', 'small', 'curly', 'h_red', 'e_green'],
    ['s2', 'round', 'round', 'thin', 'button', 'short', 'h_light', 'e_gray'],
    ['s10', 'long', 'monolid', 'straight', 'straight', 'short', 'h_black', 'e_dark'],
    ['s3', 'square', 'downturned', 'thick', 'aquiline', 'bald', 'h_dark', 'e_hazel'],
    ['s4', 'diamond', 'hooded', 'bushy', 'wide', 'curly', 'h_dark', 'e_brown'],
    ['s11', 'oval', 'almond', 'arched', 'soft', 'long', 'h_brown', 'e_amber'],
    ['s5', 'heart', 'round', 'soft', 'small', 'afro', 'h_dark', 'e_dark'],
    ['s12', 'square', 'monolid', 'thick', 'straight', 'short', 'h_black', 'e_black'],
    ['s6', 'round', 'hooded', 'straight', 'wide', 'bald', 'h_black', 'e_dark'],
    ['s13', 'long', 'upturned', 'thin', 'aquiline', 'long', 'h_black', 'e_brown'],
    ['s7', 'diamond', 'downturned', 'bushy', 'button', 'afro', 'h_black', 'e_dark'],
    ['s8', 'oval', 'almond', 'thick', 'wide', 'curly', 'h_black', 'e_black'],
    ['s14', 'heart', 'round', 'arched', 'soft', 'short', 'h_black', 'e_dark'],
    ['f_lunar', 'oval', 'upturned', 'thin', 'small', 'long', 'h_lavender', 'e_ice'],
    ['f_cosmic', 'diamond', 'almond', 'arched', 'straight', 'curly', 'h_pink', 'e_gold'],
    ['f_jade', 'round', 'round', 'soft', 'button', 'afro', 'h_teal', 'e_violet'],
    ['s4', 'long', 'almond', 'straight', 'aquiline', 'short', 'h_gray', 'e_hazel'],
  ].map(([skin, faceShape, eyes, brows, nose, hair, hairColor, eyeColor]) => ({
    label: `${skin} · ${faceShape} · ${eyes} · ${nose}`,
    config: { ...LOOK_BASE, skin, faceShape, eyes, brows, nose, hair, hairColor, eyeColor, topColor: 'c_white' },
  })),
  expressions: ['smile', 'grin', 'calm', 'wink', 'laugh', 'cool', 'blush', 'kiss', 'serene', 'smirk', 'surprised', 'starry', 'hearts'].flatMap((face) => [
    { label: face, config: { ...LOOK_BASE, face, skin: 's4', faceShape: 'oval', eyes: 'almond', hair: 'short', hairColor: 'h_dark', topColor: 'c_navy' } },
  ]).concat(
    ['smile', 'grin', 'calm', 'wink', 'laugh', 'cool', 'blush', 'kiss', 'serene', 'smirk', 'surprised', 'starry', 'hearts'].map((face) => ({
      label: face,
      config: { ...LOOK_BASE, face, skin: 's7', faceShape: 'heart', eyes: 'round', brows: 'arched', nose: 'small', hair: 'afro', hairColor: 'h_black', topColor: 'c_coral' },
    })),
  ),
  mature: [
    { label: 'linhas suaves · grisalho', config: { ...LOOK_BASE, lines: 'soft', hair: 'short', hairColor: 'h_gray', skin: 's3', faceShape: 'oval', eyes: 'hooded', brows: 'soft', nose: 'straight', face: 'smile', topColor: 'c_navy' } },
    { label: 'linhas marcadas · prateado', config: { ...LOOK_BASE, lines: 'marked', hair: 'long', hairColor: 'h_silver', skin: 's2', faceShape: 'long', eyes: 'downturned', brows: 'thin', nose: 'aquiline', face: 'smile', topColor: 'c_purple' } },
    { label: 'linhas marcadas · branco', config: { ...LOOK_BASE, lines: 'marked', hair: 'afro', hairColor: 'h_white', skin: 's7', faceShape: 'round', eyes: 'almond', brows: 'bushy', nose: 'wide', face: 'laugh', topColor: 'c_white' } },
    { label: 'linhas suaves · sal e pimenta', config: { ...LOOK_BASE, lines: 'soft', hair: 'curly', hairColor: 'h_salt', skin: 's5', faceShape: 'square', eyes: 'almond', brows: 'thick', nose: 'soft', face: 'calm', topColor: 'c_olive' } },
    { label: 'linhas marcadas · careca', config: { ...LOOK_BASE, lines: 'marked', hair: 'bald', hairColor: 'h_gray', skin: 's13', faceShape: 'long', eyes: 'hooded', brows: 'bushy', nose: 'aquiline', face: 'smile', topColor: 'c_beige' } },
    { label: 'linhas suaves · prateado', config: { ...LOOK_BASE, lines: 'soft', hair: 'short', hairColor: 'h_silver', skin: 's10', faceShape: 'heart', eyes: 'monolid', brows: 'soft', nose: 'small', face: 'smile', topColor: 'c_coral' } },
    { label: 'linhas marcadas · grafite', config: { ...LOOK_BASE, lines: 'marked', hair: 'long', hairColor: 'h_steel', skin: 's12', faceShape: 'oval', eyes: 'round', brows: 'arched', nose: 'straight', face: 'smirk', topColor: 'c_teal' } },
    { label: 'linhas suaves · branco', config: { ...LOOK_BASE, lines: 'soft', hair: 'curly', hairColor: 'h_white', skin: 's14', faceShape: 'diamond', eyes: 'downturned', brows: 'thin', nose: 'wide', face: 'grin', topColor: 'c_red' } },
  ],
  // os 4 repousos (o mesmo rosto/corpo muda só o que a variante de repouso pede: peso, braços, pés)
  rests: [
    { label: 'peso na direita · braços soltos', config: { ...LOOK_BASE, body: 'regular', faceShape: 'oval', eyes: 'round', skin: 's4', hair: 'short', hairColor: 'h_dark', topColor: 'c_gray' } },
    { label: 'mão na cintura', config: { ...LOOK_BASE, body: 'regular', faceShape: 'oval', eyes: 'almond', skin: 's4', hair: 'short', hairColor: 'h_dark', topColor: 'c_gray' } },
    { label: 'mão na frente da coxa', config: { ...LOOK_BASE, body: 'regular', faceShape: 'oval', eyes: 'downturned', skin: 's4', hair: 'short', hairColor: 'h_dark', topColor: 'c_gray' } },
    { label: 'polegar no passante', config: { ...LOOK_BASE, body: 'regular', faceShape: 'oval', eyes: 'monolid', skin: 's4', hair: 'short', hairColor: 'h_dark', topColor: 'c_gray' } },
  ],
  // poses paradas com cotovelo e joelho dobrados (ART_POSES) + sentado na cadeira (a cadeira é do dono dos veículos)
  poses: [
    { label: 'repouso', config: { ...LOOK_BASE, body: 'regular', faceShape: 'oval', eyes: 'round', skin: 's6', hair: 'curly', hairColor: 'h_black', topColor: 'c_orange', face: 'smile' } },
    { label: 'acenando', pose: 'hello', hands: { R: 'open' }, config: { ...LOOK_BASE, body: 'regular', faceShape: 'oval', eyes: 'round', skin: 's6', hair: 'curly', hairColor: 'h_black', topColor: 'c_orange', face: 'grin' } },
    { label: 'dançando', pose: 'dance', hands: { L: 'open' }, config: { ...LOOK_BASE, body: 'slim', faceShape: 'heart', eyes: 'almond', skin: 's10', hair: 'long', hairColor: 'h_black', topColor: 'c_purple', face: 'laugh' } },
    { label: 'dançando 2', pose: 'dance2', hands: { R: 'open' }, config: { ...LOOK_BASE, body: 'athletic', faceShape: 'square', eyes: 'upturned', skin: 's13', hair: 'short', hairColor: 'h_dark', topColor: 'c_teal', face: 'wink' } },
    { label: 'comemorando', pose: 'cheer', hands: { L: 'open', R: 'open' }, config: { ...LOOK_BASE, body: 'regular', faceShape: 'long', eyes: 'almond', skin: 's9', hair: 'long', hairColor: 'h_red', topColor: 'c_yellow', face: 'laugh' } },
    { label: 'cotovelo e joelho', pose: 'bend', config: { ...LOOK_BASE, body: 'curvy', faceShape: 'oval', eyes: 'almond', skin: 's5', hair: 'afro', hairColor: 'h_dark', topColor: 'c_green', face: 'smile' } },
    { label: 'sentado (cadeira de rodas)', config: { ...LOOK_BASE, body: 'plus', faceShape: 'round', eyes: 'hooded', skin: 's3', hair: 'short', hairColor: 'h_silver', lines: 'soft', topColor: 'c_navy', face: 'smile', vehicle: 'wheelchair' } },
  ],
  // mesmo cabelo e mesma pele, 6 rostos (prova de que o rosto muda a pessoa, não só a roupa)
  samehair: (
    [
      ['oval', 'almond', 'soft', 'soft'],
      ['round', 'round', 'thin', 'button'],
      ['square', 'downturned', 'thick', 'aquiline'],
      ['long', 'monolid', 'straight', 'straight'],
      ['heart', 'upturned', 'arched', 'small'],
      ['diamond', 'hooded', 'bushy', 'wide'],
    ] as const
  ).map(([faceShape, eyes, brows, nose]) => ({ label: `${faceShape} · ${eyes} · ${nose}`, config: { ...LOOK_BASE, faceShape, eyes, brows, nose, skin: 's4', hair: 'short', hairColor: 'h_dark', topColor: 'c_gray' } })),
  // sentado na cadeira de rodas (o desenho da cadeira é do dono dos veículos)
  seated: [
    { label: 'plus · grisalho', config: { ...LOOK_BASE, body: 'plus', faceShape: 'round', eyes: 'hooded', skin: 's3', hair: 'short', hairColor: 'h_silver', lines: 'soft', topColor: 'c_navy', face: 'smile', vehicle: 'wheelchair' } },
    { label: 'médio · longo', config: { ...LOOK_BASE, body: 'regular', faceShape: 'oval', eyes: 'almond', skin: 's6', hair: 'long', hairColor: 'h_black', topColor: 'c_coral', face: 'smile', vehicle: 'wheelchair' } },
    { label: 'atlético · black power', config: { ...LOOK_BASE, body: 'athletic', faceShape: 'square', eyes: 'round', skin: 's8', hair: 'afro', hairColor: 'h_black', topColor: 'c_white', bottomColor: 'c_black', face: 'grin', vehicle: 'wheelchair_sport' } },
    { label: 'esguio · cacheado', config: { ...LOOK_BASE, body: 'slim', faceShape: 'diamond', eyes: 'upturned', skin: 's1', hair: 'curly', hairColor: 'h_auburn', topColor: 'c_teal', face: 'calm', vehicle: 'wheelchair' } },
  ],
  details: (['none', 'freckles', 'mole', 'vitiligo', 'lipstick', 'liner', 'glam', 'glitter', 'star_cheek'] as const).map((faceDetail, i) => ({
    label: faceDetail,
    config: { ...LOOK_BASE, faceDetail, skin: ['s3', 's1', 's11', 's7', 's5', 's10', 's13', 's8', 's2'][i], hair: (['short', 'curly', 'long', 'bald', 'long', 'short', 'afro', 'curly', 'long'] as const)[i], hairColor: ['h_dark', 'h_red', 'h_brown', 'h_black', 'h_black', 'h_black', 'h_black', 'h_dark', 'h_blonde'][i], eyes: (['almond', 'round', 'almond', 'almond', 'downturned', 'monolid', 'almond', 'round', 'upturned'] as const)[i], topColor: 'c_white' },
  })),
};

/**
 * poses paradas do diretor de arte (cotovelo e joelho dobrados). Partem do braço SOLTO de cada pessoa: a folha soma
 * restArmDelta(anatomia) antes de aplicar (fromHang), então valem pra qualquer repouso (mão na cintura, na coxa…).
 * Ângulos: positivo = horário na tela; o braço esquerdo da tela sobe girando no horário, o direito no anti-horário.
 */
export const ART_POSES: Record<string, (p: Pose) => Pose> = {
  dance: (p) => {
    // rebolado: braço esquerdo erguido com o cotovelo dobrado por cima da cabeça (mão aberta), mão direita na cintura;
    // peso na perna direita, joelho esquerdo dobrado pra frente e pra fora (nada de pernas em X)
    p.body.r = 4;
    p.body.dy = 1.0;
    p.head.r = -6;
    p.armL.r = 124;
    p.foreL = { r: 96 };
    p.armR.r = -34;
    p.foreR = { r: 96 };
    p.legL.r = 9;
    p.shinL = { r: -15 };
    p.legR.r = -2;
    p.shinR = { r: 1 };
    return p;
  },
  dance2: (p) => {
    // groove: braço direito erguido pro lado com o cotovelo dobrado (mão aberta), mão esquerda na cintura; perna
    // esquerda cruza na frente com o joelho pra fora e o pé virado pra fora, peso na direita
    p.body.r = -5;
    p.body.dy = 1.4;
    p.head.r = 7;
    p.armL.r = 32;
    p.foreL = { r: -80 };
    p.armR.r = -118;
    p.foreR = { r: -48 };
    p.legL.r = -5;
    p.shinL = { r: 17 };
    p.legR.r = 3;
    p.shinR = { r: -2 };
    return p;
  },
  hello: (p) => {
    // aceno: braço direito erguido pro lado, antebraço em pé, mão aberta com a palma pra câmera
    p.head.r = 3;
    p.body.r = -1.5;
    p.armR.r = -108;
    p.foreR = { r: -60 };
    p.armL.r = 2;
    p.foreL = { r: -6 };
    return p;
  },
  bend: (p) => {
    // cotovelos e joelhos dobrados (prova de que as juntas não abrem fresta)
    p.armL.r = 25;
    p.armR.r = -25;
    p.foreL = { r: -70 };
    p.foreR = { r: 70 };
    p.legL.r = 18;
    p.legR.r = -18;
    p.shinL = { r: -32 };
    p.shinR = { r: 32 };
    return p;
  },
  cheer: (p) => {
    // comemorando: braços erguidos em V, cotovelos levemente dobrados, mãos abertas (cabe no viewBox: mãos em y ≥ 1
    // até no corpo mais alto)
    p.head.r = -3;
    p.body.dy = 1.0;
    p.armL.r = 126;
    p.foreL = { r: 26 };
    p.armR.r = -126;
    p.foreR = { r: -26 };
    p.legL.r = 4;
    p.shinL = { r: -8 };
    p.legR.r = -4;
    p.shinR = { r: 8 };
    return p;
  },
  hip: (p) => {
    p.head.r = 4;
    p.armL.r = 32;
    p.foreL = { r: -78 };
    p.armR.r = -6;
    p.foreR = { r: 12 };
    p.legR.r = 4;
    p.shinR = { r: -10 };
    return p;
  },
};

function preset(name: string): Partial<AvatarConfig> {
  if (name.startsWith('random:')) return SU.randomAvatarConfig(name.slice(7), { tiers: SU.ALL_TIERS });
  const legacyIdx: Record<string, number> = { r1: 1, r2: 2, r3: 3, r4: 4, r5: 5, r6: 6, gear: 7, dress: 8, afro: 9, scarf: 10, neon: 11 };
  if (name in legacyIdx) return LEGACY_SET[legacyIdx[name]].config;
  if (name === 'default') return {};
  throw new Error(`preset desconhecido: ${name}`);
}

export function finalize(partial: Partial<AvatarConfig>, raw: boolean): AvatarConfig {
  const merged = { ...DEFAULT_LEGACY, ...partial } as AvatarConfig;
  return raw ? merged : (SU.normalizeAvatarConfig(merged, SU.ALL_TIERS) as AvatarConfig);
}

// ---------------------------------------------------------------------------------------------------------------
// poses e animações
// ---------------------------------------------------------------------------------------------------------------
const MAP_STATES = ['idle', 'walk', 'run', 'wave', 'like', 'celebrate', 'match', 'arrive'] as const;
type MapState = (typeof MAP_STATES)[number];

/** pose de uma animação no progresso k 0..1 */
function animPose(id: string, k: number): Pose | null {
  const def = emoteDef(id);
  if (def) return def.pose(k, k * def.dur, NEUTRAL_VARIATION);
  if ((MAP_STATES as readonly string[]).includes(id)) {
    const dur = anim.DUR[id as MapState] || (id === 'idle' ? 2.6 : id === 'walk' ? 1 / anim.WALK.freq : 1 / anim.RUN.freq);
    return anim.pose(id as MapState, k * dur, NEUTRAL_VARIATION);
  }
  return null;
}

/**
 * célula de um quadro de animação como o palco monta: pose do registro + braço solto da pessoa (quando usa os braços),
 * expressão e objeto da linha do tempo e a mão aberta que a animação pede; a cena entra com `usesArms`
 */
function emoteCell(c: Cell, id: string, k: number): Cell {
  const def = emoteDef(id);
  const p = animPose(id, k);
  if (!p) throw new Error(`animação desconhecida: ${id}`);
  // estados do mapa: a passada e os gestos de braço partem do braço solto da pessoa (como o MapEngine soma restArms)
  const hang = !def && (id === 'walk' || id === 'run' || anim.usesArmsOf(id as MapState));
  if (!def || !c.cfg) return { ...c, label: `${id} k=${k.toFixed(2)}`, pose: p, emote: id, k, fromHang: hang, usesArms: hang && id !== 'walk' && id !== 'run' };
  const cfg = { ...c.cfg, face: emoteFaceAt(def, k) ?? c.cfg.face, held: def.prop ?? c.cfg.held } as AvatarConfig;
  const hands = emoteHands(id) ?? undefined;
  return { ...c, label: `${id} k=${k.toFixed(2)}`, cfg, baseCfg: c.cfg, pose: p, emote: id, k, fromHang: def.usesArms, usesArms: def.usesArms, hands };
}

/** pose do diretor de arte → a partir do braço SOLTO desta pessoa (qualquer repouso: mão na cintura, na coxa…) */
export function fromHang(pose: Pose, cfg: AvatarConfig, rig: AvatarRig): Pose {
  const d = restArmDelta(buildAnatomy(cfg, rig.scene ?? null));
  const p = clonePose(pose);
  p.armL.r += d.armL;
  p.armR.r += d.armR;
  p.foreL = { r: (p.foreL?.r ?? 0) + d.foreL };
  p.foreR = { r: (p.foreR?.r ?? 0) + d.foreR };
  return p;
}

function namedPose(name: string): Pose {
  const p = zero();
  switch (name) {
    case 'zero':
      return p;
    case 'tpose':
      p.armL.r = 80;
      p.armR.r = -80;
      return p;
    case 'bend':
      // cotovelos e joelhos dobrados: prova que as juntas não abrem fresta
      p.armL.r = 25;
      p.armR.r = -25;
      p.foreL = { r: -70 };
      p.foreR = { r: 70 };
      p.legL.r = 18;
      p.legR.r = -18;
      p.shinL = { r: -32 };
      p.shinR = { r: 32 };
      return p;
    case 'reach':
      p.armR.r = -120;
      p.foreR = { r: -40 };
      p.armL.r = 10;
      p.foreL = { r: 60 };
      return p;
    default: {
      if (ART_POSES[name]) return ART_POSES[name](p);
      const keyK: Record<string, number> = { wave: 0.42, celebrate: 0.25, like: 0.35, match: 0.4, arrive: 0.3, walk: 0.25, run: 0.25, idle: 0 };
      const ap = animPose(name, keyK[name] ?? emoteDef(name)?.keyK ?? 0.5);
      if (ap) return ap;
      throw new Error(`pose desconhecida: ${name}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// células
// ---------------------------------------------------------------------------------------------------------------
interface Cell {
  label: string;
  cfg: AvatarConfig | null;
  pose: Pose | null;
  /** a pose parte do braço solto da pessoa (soma restArmDelta da anatomia) */
  fromHang?: boolean;
  /** mãos abertas (palma pra câmera) */
  hands?: { L?: 'open'; R?: 'open' };
  /** camadas prontas (demo) em vez de config */
  layers?: AvatarLayer[];
  rig?: AvatarRig | null;
  /** animação e progresso (o renderer do palco troca expressão/objeto como no app) */
  emote?: string;
  k?: number;
  /** renderer desta célula (com --renderer all) */
  renderer?: 'svg' | 'map' | 'stage';
  /** a pose mexe nos braços (a cena não segura as mãos no volante/guidão/colo) */
  usesArms?: boolean;
  /** config antes da troca de expressão/objeto da animação (o palco monta esta e troca pelos papéis) */
  baseCfg?: AvatarConfig;
}

function buildCells(a: Args): Cell[] {
  const cells: Cell[] = [];
  const pose = a.pose ? namedPose(a.pose) : null;
  const basePartial = preset(a.base);
  if (a.set === 'legacy') {
    for (const s of LEGACY_SET) cells.push({ label: s.label, cfg: finalize(s.config, a.raw), pose });
  } else if (a.set) {
    const set = ART_SETS[a.set];
    if (!set) throw new Error(`conjunto desconhecido: ${a.set} (legacy | ${Object.keys(ART_SETS).join(' | ')})`);
    for (const s of set) cells.push({ label: s.label, cfg: finalize({ ...basePartial, ...s.config }, a.raw), pose: s.pose ? namedPose(s.pose) : pose, fromHang: !!(s.pose && ART_POSES[s.pose]), hands: s.hands });
  }
  for (const file of a.configsFiles) {
    const list = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown[];
    list.forEach((it, i) => {
      const o = it as { label?: string; config?: Partial<AvatarConfig>; pose?: string; emote?: string; k?: number; hands?: Cell['hands'] };
      const partial = o.config ?? (it as Partial<AvatarConfig>);
      const cell: Cell = { label: o.label ?? `#${i + 1}`, cfg: finalize({ ...basePartial, ...partial }, a.raw), pose, hands: o.hands };
      if (o.pose) {
        cell.pose = namedPose(o.pose);
        cell.fromHang = !!ART_POSES[o.pose];
      }
      cells.push(o.emote ? { ...emoteCell(cell, o.emote, o.k ?? emoteDef(o.emote)?.keyK ?? 0.5), label: cell.label } : cell);
    });
  }
  for (const c of a.configs) cells.push({ label: Object.entries(c).map(([k, v]) => `${k}=${v}`).join(' ').slice(0, 40), cfg: finalize({ ...basePartial, ...c }, a.raw), pose });
  if (a.slot) {
    const itemSlot = SU.AVATAR_ITEM_SLOTS.find((s: { slot: string }) => s.slot === a.slot);
    const colorSlot = SU.AVATAR_COLOR_SLOTS.find((s: { slot: string }) => s.slot === a.slot);
    const def = itemSlot ?? colorSlot;
    if (!def) throw new Error(`slot desconhecido: ${a.slot}`);
    for (const it of def.items as { id: string; label: string }[]) {
      cells.push({ label: `${it.label} (${it.id})`, cfg: finalize({ ...basePartial, [a.slot]: it.id }, a.raw), pose });
    }
  }
  if (!cells.length) cells.push({ label: a.base, cfg: finalize(basePartial, a.raw), pose });
  if (a.emote) {
    const out: Cell[] = [];
    for (const c of cells) {
      for (let i = 0; i < a.frames; i++) {
        const k = a.frames === 1 ? (emoteDef(a.emote)?.keyK ?? 0.5) : i / (a.frames - 1);
        out.push(emoteCell(c, a.emote, k));
      }
    }
    return out;
  }
  return cells;
}

// ---------------------------------------------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------------------------------------------
const BG = { dark: { page: '#0A0A1A', cell: '#14142A', text: '#C8C8D8' }, light: { page: '#F4F4F8', cell: '#FFFFFF', text: '#2A2A36' } };

/** SVG de uma célula (sem o <svg> externo): mesma lógica do <CruzeiAvatar/> */
function cellSvg(cell: Cell, idp: string, a: Args, mode: 'full' | 'bust'): string {
  let layers: AvatarLayer[];
  let rig: AvatarRig | null = null;
  let pose = cell.pose;
  if (cell.layers) {
    layers = cell.layers;
    rig = cell.rig ?? null;
  } else {
    const cfg = cell.cfg as AvatarConfig;
    const shadow = a.shadow ?? mode === 'full';
    const bo = { groundShadow: shadow && mode === 'full', mode, ...(a.lite ? { lod: 'lite' as const } : {}), ...(cell.hands ? { hands: cell.hands } : {}) };
    layers = buildAvatarLayers(cfg, bo);
    // objeto da animação com o pet no colo: como o palco (stage/assets.ts), vem da montagem sem o pet (o bicho desce)
    if (cell.usesArms && cfg.held && cfg.held !== 'none' && propFreesHands(cfg) && !layers.some((l) => l.k === 'held' || l.k === 'prop')) {
      layers = [...layers, ...layersWithTag(buildAvatarLayers(propConfig(cfg, cfg.held), bo), ['held', 'prop'])];
    }
    rig = buildAvatarRig(cfg, { mode });
    if (pose && cell.fromHang) pose = fromHang(pose, cfg, rig);
    // a cena (sentado, pernas na moto, mãos no volante) entra mesmo sem animação, como no app
    if (rig.scene) pose = applyScene(pose ? clonePose(pose) : zero(), rig.scene, 0, { usesArms: !!cell.usesArms });
  }
  const model = buildSvgModel(a.micro ? microLayers(layers) : layers, { idp, rig, pose, blur: a.blur });
  return svgModelToString(model);
}

type RendererName = 'svg' | 'map' | 'stage';

const LOOK = { recent: true, boosted: false, premiumTier: 'free', verified: false, aura: '', anonymous: false };

/** recorte da célula: corpo inteiro = viewBox; busto = recorte desta pessoa (o mesmo do <CruzeiAvatar/>) */
function cellVb(cell: Cell, mode: 'full' | 'bust'): { x: number; y: number; w: number; h: number } {
  if (mode !== 'bust') return AVATAR_VIEWBOX;
  return cell.cfg ? bustBoxFor(cell.cfg) : { x: 27.5, y: 1.5, w: 45, h: 45 };
}

/** PNG de uma célula w×h pelo renderer pedido */
async function cellPng(cell: Cell, idx: number, a: Args, mode: 'full' | 'bust', w: number, h: number, renderer: RendererName): Promise<Buffer> {
  const vb = cellVb(cell, mode);
  if (renderer === 'svg') {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}">${cellSvg(cell, `c${idx}_`, a, mode)}</svg>`;
    return sharp(Buffer.from(svg)).png().toBuffer();
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { installSkia } = require('./avatar-sheet-skia') as typeof import('./avatar-sheet-skia');
  const Skia = await installSkia();
  const fit = (bytes: Uint8Array | null) => {
    if (!bytes) throw new Error(`o renderer ${renderer} não devolveu imagem (célula ${idx})`);
    return sharp(Buffer.from(bytes)).resize(w, h, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  };
  const cfg = cell.cfg as AvatarConfig;
  const shadow = a.shadow ?? mode === 'full';
  /* eslint-disable @typescript-eslint/no-var-requires */
  if (renderer === 'map') {
    // o raster do mapa de verdade (figura 72x112 proporcional; presença recente = anel lima nos pés)
    const { mapDraw } = require('../src/screens/map/native/images/draw');
    const { mapAvatarDef, mapAuraRgb } = require('../src/screens/map/native/images/mapAvatar');
    const look = { ...LOOK, premiumTier: a.tier ?? LOOK.premiumTier, aura: a.mapAura && cfg ? mapAuraRgb(cfg) : '' };
    const dim = { w: Math.round((h * 72) / 112), h };
    const def = cell.layers ? { l: cell.layers, p: cell.rig ?? buildAvatarRig(finalize({}, a.raw)) } : mapAvatarDef(cfg);
    let mp = cell.pose;
    if (mp && cell.fromHang && !cell.layers) mp = fromHang(mp, cfg, def.p);
    return fit(mapDraw.figure(def, look, dim, mp, false, cell.usesArms != null ? { usesArms: cell.usesArms ? 1 : 0 } : undefined));
  }
  // palco: SkPictures por corrida (stage/assets.ts) + matriz base + matriz do grupo, como o AvatarStage faz na thread de UI
  const { stageAssets } = require('../src/components/avatar/stage/assets');
  const { stageLayout } = require('../src/components/avatar/stage/layout');
  const { roleVisible } = require('../src/components/avatar/stage/stageLayers');
  const { groupMatrix, mToSkia } = require('../src/avatar/rig');
  const { makeLayerPaints, paintLayer, parseLayerPath } = require('../src/avatar/skia/paintLayer');
  /* eslint-enable @typescript-eslint/no-var-requires */
  const L = stageLayout(mode, h);
  const surf = Skia.Surface.Make(Math.round(L.w * 2), Math.round(L.h * 2));
  const c = surf.getCanvas();
  c.clear(Skia.Color('rgba(0,0,0,0)'));
  c.scale(2, 2);
  c.concat(L.base);
  if (cell.layers) {
    const env = { track: (o: unknown) => o, path: (d: string, e: boolean) => parseLayerPath(d, e), color: (css: string) => Skia.Color(css) };
    const rec = Skia.PictureRecorder();
    const rc = rec.beginRecording({ x: -60, y: -60, width: 220, height: 280 });
    const paints = makeLayerPaints(env);
    for (const l of cell.layers) paintLayer(rc, l, env, paints);
    c.drawPicture(rec.finishRecordingAsPicture());
  } else {
    const def = cell.emote ? emoteDef(cell.emote) : null;
    // o palco monta a config original e troca expressão/objeto/mão pelos papéis (a célula de animação já veio trocada)
    const base = cell.baseCfg ?? cfg;
    const assets = stageAssets(base, mode, shadow, def);
    const rig = assets.rig as AvatarRig;
    let pose = cell.pose ? clonePose(cell.pose) : zero();
    if (cell.fromHang) pose = fromHang(pose, cfg, rig);
    if (rig.scene) pose = applyScene(pose, rig.scene, 0, { usesArms: !!cell.usesArms });
    let face = -1;
    let prop = false;
    let hands = false;
    if (def && cell.k != null) {
      const f = emoteFaceAt(def, cell.k);
      face = f == null ? -1 : assets.altFaces.indexOf(f);
      prop = assets.hasProp;
      hands = assets.hasHands;
    }
    for (const run of assets.runs) {
      if (!roleVisible(run.role, face, prop, hands)) continue;
      c.save();
      c.concat(mToSkia(groupMatrix(run.g, rig, pose)));
      c.drawPicture(run.picture);
      c.restore();
    }
  }
  surf.flush();
  return fit(surf.makeImageSnapshot().encodeToBytes());
}

async function renderSheet(cellsIn: Cell[], a: Args): Promise<void> {
  const mode = a.mode;
  const h = a.size ?? (mode === 'bust' ? 120 : 220);
  const w = mode === 'bust' ? h : Math.round((h * AVATAR_VIEWBOX.w) / AVATAR_VIEWBOX.h);
  const tags: Record<RendererName, string> = { svg: 'SVG', map: 'mapa', stage: 'palco' };
  let cells = cellsIn;
  let cols0 = a.cols ?? Math.min(6, cells.length);
  if (a.renderer === 'all') {
    // uma linha por renderer, mesmas colunas
    const rs: RendererName[] = ['svg', 'map', 'stage'];
    const out: Cell[] = [];
    const cols = a.cols ?? Math.min(8, cellsIn.length);
    for (let start = 0; start < cellsIn.length; start += cols) {
      const slice = cellsIn.slice(start, start + cols);
      for (const r of rs) for (const c of slice) out.push({ ...c, renderer: r, label: `${c.label} · ${tags[r]}` });
    }
    cells = out;
    cols0 = cols;
  }
  const small = h < 80;
  const pad = small ? 6 : 12;
  const labelH = a.label ? (small ? 12 : 18) : 0;
  const cols = Math.max(1, Math.min(cols0, cells.length));
  const rows = Math.ceil(cells.length / cols);
  const W = cols * (w + pad) + pad;
  const H = rows * (h + pad + labelH) + pad;
  const colors = BG[a.bg];
  const bg: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`, `<rect width="${W}" height="${H}" fill="${colors.page}"/>`];
  const jobs: (() => Promise<{ input: Buffer; left: number; top: number }>)[] = [];
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = pad + col * (w + pad);
    const y = pad + row * (h + pad + labelH);
    bg.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${small ? 4 : 10}" fill="${colors.cell}"/>`);
    if (a.label) {
      const fs2 = small ? 8 : 11;
      const txt = c.label.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      bg.push(`<text x="${x + w / 2}" y="${y + h + labelH - (small ? 3 : 5)}" font-family="Segoe UI, Arial, sans-serif" font-size="${fs2}" fill="${colors.text}" text-anchor="middle">${txt}</text>`);
    }
    const renderer: RendererName = c.renderer ?? (a.renderer === 'all' ? 'svg' : a.renderer);
    jobs.push(async () => ({ input: await cellPng(c, i, a, mode, w, h, renderer), left: x, top: y }));
  }
  bg.push('</svg>');
  // células em paralelo (o Skia do mapa/palco é síncrono; o sharp usa as threads do libvips)
  const comps: { input: Buffer; left: number; top: number }[] = [];
  const par = Math.max(1, Number(process.env.SHEET_PAR) || 6);
  for (let s0 = 0; s0 < jobs.length; s0 += par) comps.push(...(await Promise.all(jobs.slice(s0, s0 + par).map((j) => j()))));
  if (process.env.SHEET_SVG) fs.writeFileSync(process.env.SHEET_SVG, bg.join(''));
  await sharp(Buffer.from(bg.join(''))).composite(comps).png().toFile(a.out);
  console.log(`ok: ${a.out} (${cells.length} células, ${W}x${H})`);
}

// ---------------------------------------------------------------------------------------------------------------
// demo da infraestrutura: gradiente, recorte, desfoque, tracejado, juntas
// ---------------------------------------------------------------------------------------------------------------
function demoCells(a: Args): Cell[] {
  const cells: Cell[] = [];
  // 1) gradiente linear e radial (com foco) no preenchimento e no traço
  cells.push({
    label: 'gradiente (gf/gs)',
    cfg: null,
    pose: null,
    layers: [
      { d: rrect(14, 16, 72, 46, 14), f: '#7FFF00', gf: { t: 'l', x1: 14, y1: 16, x2: 86, y2: 62, s: [[0, '#7FFF00'], [0.55, '#FFD700'], [1, '#FF1493']] } },
      { d: circle(50, 98, 26), f: '#FF1493', gf: { t: 'r', cx: 50, cy: 98, r: 26, fx: 42, fy: 88, s: [[0, '#FFFFFF'], [0.35, '#FF7AC3'], [1, '#8A0050']] } },
      { d: circle(50, 98, 30), s: '#000', w: 3, gs: { t: 'l', x1: 20, y1: 98, x2: 80, y2: 98, s: [[0, '#7FFF00'], [1, '#FFD700', 0.2]] } },
    ],
  });
  // 2) recorte: listras e brilho só dentro do círculo
  const stripes: AvatarLayer[] = [];
  const clip = circle(50, 70, 34);
  const flag = ['#E40303', '#FF8C00', '#FFED00', '#008026', '#004DFF', '#750787'];
  flag.forEach((c, i) => stripes.push({ d: `M0,${36 + i * 11.4}H100V${36 + (i + 1) * 11.4 + 0.3}H0Z`, f: c, cp: clip }));
  stripes.push({ d: ellipse(38, 52, 16, 9), f: 'rgba(255,255,255,0.55)', b: 3, cp: clip });
  stripes.push({ d: clip, s: '#FFFFFF', w: 1.6 });
  cells.push({ label: 'recorte (cp) + brilho', cfg: null, pose: null, layers: stripes });
  // 3) desfoque: sombra de contato e brilho de borda
  cells.push({
    label: 'desfoque (b)',
    cfg: null,
    pose: null,
    layers: [
      { d: ellipse(50, 128, 30, 5), f: 'rgba(0,0,0,0.6)', b: 2.5 },
      { d: circle(50, 72, 30), f: '#E8B590', gf: { t: 'r', cx: 44, cy: 62, r: 40, s: [[0, '#F6CDAA'], [1, '#C98F66']] } },
      { d: ellipse(50, 96, 22, 6), f: 'rgba(80,30,10,0.45)', b: 3, cp: circle(50, 72, 30) },
      { d: ellipse(40, 56, 9, 6), f: '#FFFFFF', o: 0.55, b: 2.2 },
      { d: circle(50, 72, 34), f: 'none', s: '#7FFF00', w: 2.5, b: 2.5 },
    ],
  });
  // 4) tracejado: costuras
  cells.push({
    label: 'tracejado (da)',
    cfg: null,
    pose: null,
    layers: [
      { d: rrect(18, 20, 64, 100, 12), f: '#4A6FA5', gf: { t: 'l', x1: 18, y1: 20, x2: 82, y2: 120, s: [[0, '#5B82BC'], [1, '#34507A']] } },
      { d: rrect(22, 24, 56, 92, 9), s: '#E8C27A', w: 1, da: [2.2, 1.6] },
      { d: 'M50,24 V116', s: '#E8C27A', w: 1, da: [2.2, 1.6] },
      { d: 'M26,60 Q50,70 74,60', s: '#E8C27A', w: 1.2, da: [3, 2], c: 'butt' },
    ],
  });
  // 5..7) juntas: avatar de verdade com cotovelos e joelhos dobrados
  const base = finalize({}, a.raw);
  cells.push({ label: 'juntas: neutra', cfg: base, pose: zero() });
  cells.push({ label: 'juntas: dobradas', cfg: base, pose: namedPose('bend') });
  cells.push({ label: 'juntas: alcance', cfg: finalize({ top: 'hoodie', topColor: 'c_lime' }, a.raw), pose: namedPose('reach') });
  cells.push({ label: 'tpose (manga curta)', cfg: finalize({ top: 'tee', topColor: 'c_pink', bottom: 'shorts' }, a.raw), pose: namedPose('tpose') });
  return cells;
}

// ---------------------------------------------------------------------------------------------------------------
// diff de PNGs
// ---------------------------------------------------------------------------------------------------------------
async function diffPngs(aPath: string, bPath: string, out: string): Promise<void> {
  const A = await sharp(aPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const B = await sharp(bPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (A.info.width !== B.info.width || A.info.height !== B.info.height) {
    console.log(`tamanhos diferentes: ${A.info.width}x${A.info.height} vs ${B.info.width}x${B.info.height}`);
    return;
  }
  const { width, height } = A.info;
  const n = width * height;
  const vis = Buffer.alloc(n * 4);
  let changed = 0;
  let strong = 0;
  let max = 0;
  let sum = 0;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const d = Math.max(Math.abs(A.data[o] - B.data[o]), Math.abs(A.data[o + 1] - B.data[o + 1]), Math.abs(A.data[o + 2] - B.data[o + 2]), Math.abs(A.data[o + 3] - B.data[o + 3]));
    const gray = Math.round((A.data[o] + A.data[o + 1] + A.data[o + 2]) / 3 / 3);
    vis[o] = gray;
    vis[o + 1] = gray;
    vis[o + 2] = gray;
    vis[o + 3] = 255;
    if (d > 0) {
      changed++;
      sum += d;
      if (d > max) max = d;
      if (d > 24) {
        strong++;
        const x = i % width;
        const y = Math.floor(i / width);
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
      const amp = Math.min(255, 60 + d * 4);
      vis[o] = amp;
      vis[o + 1] = d > 24 ? 0 : Math.round(amp * 0.6);
      vis[o + 2] = 0;
    }
  }
  await sharp(vis, { raw: { width, height, channels: 4 } }).png().toFile(out);
  console.log(
    JSON.stringify({
      pixels: n,
      changed,
      changedPct: +((changed / n) * 100).toFixed(4),
      strong_gt24: strong,
      strongPct: +((strong / n) * 100).toFixed(4),
      maxDelta: max,
      meanDeltaChanged: changed ? +(sum / changed).toFixed(2) : 0,
      strongBBox: strong ? [x0, y0, x1, y1] : null,
      out,
    }),
  );
}

// ---------------------------------------------------------------------------------------------------------------
async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  a.out = path.resolve(a.out);
  if (a.diff) return diffPngs(path.resolve(a.diff[0]), path.resolve(a.diff[1]), a.out);
  if (a.demo === 'infra') {
    if (!a.size) a.size = 200;
    if (!a.cols) a.cols = 4;
    a.label = true;
    return renderSheet(demoCells(a), a);
  }
  return renderSheet(buildCells(a), a);
}

// roda só como comando (importar o módulo, ex. pra reaproveitar LEGACY_SET, não dispara nada)
if (require.main === module) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.stack || e.message : e);
    process.exit(1);
  });
}
