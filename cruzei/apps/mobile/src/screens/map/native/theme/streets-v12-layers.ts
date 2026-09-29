// Tabela estática das camadas do estilo clássico mapbox://styles/mapbox/streets-v12 (134 camadas). O SDK nativo
// (@rnmapbox/maps) não tem getStyle(), então o walker do antigo WebView (mapbox-html.ts:186-237, classifyLayer +
// applyTheme) virou dado: o BaseTheme recolore cada camada daqui com a prop `existing`.
//
// GERADO a partir do JSON do estilo (GET https://api.mapbox.com/styles/v1/mapbox/streets-v12?access_token=... salvo
// em disco; o token nunca entra no repositório), aplicando EXATAMENTE a regra do classifyLayer (sem o teste de 'cz-').
// Para regenerar, salve o script abaixo como gen.js, rode `node gen.js streets-v12.json` e cole a saída: linhas
// [id, tipo, grupo] em STREETS_V12_LAYERS, depois FIRST_ROAD_LAYER_ID, FIRST_LABEL_LAYER_ID e as linhas com { cores }
// em STREETS_V12_UNTHEMED.
//
//   const s = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
//   const K = (l, id = l.id, sl = l['source-layer'] || '') =>
//     l.type === 'background' ? 'bg'
//     : l.type === 'fill' && sl === 'water' ? 'water'
//     : l.type === 'fill' && /park|grass|pitch|garden|wood|scrub|cemetery|national/.test(id) ? 'park'
//     : l.type === 'fill' && ['landuse', 'landcover', 'landuse_overlay'].includes(sl) ? 'landuse'
//     : l.type === 'fill' && sl === 'building' ? 'building'
//     : l.type === 'line' && sl === 'road'
//       ? /case/.test(id) ? 'roadCase' : /motorway|trunk/.test(id) ? 'highway' : /primary/.test(id) ? 'primary'
//         : /secondary|tertiary/.test(id) ? 'secondary' : 'road'
//     : l.type === 'symbol' ? 'symbol' : null;
//   const q = (v) => (Array.isArray(v) ? `[${v.map(q).join(', ')}]` : typeof v === 'string' ? `'${v}'` : String(v));
//   const cc = (k) => k.replace(/-(\w)/g, (_, c) => c.toUpperCase());
//   const C = ['fill-color', 'fill-outline-color', 'line-color', 'circle-color', 'circle-stroke-color'];
//   for (const l of s.layers) if (K(l)) console.log(`  [${q(l.id)}, ${q(l.type)}, ${q(K(l))}],`);
//   console.log(s.layers.find((l) => l.type === 'line' && l['source-layer'] === 'road').id);
//   console.log(s.layers.find((l) => l.type === 'symbol' && l.layout?.['text-field']).id);
//   for (const l of s.layers) {
//     const p = K(l) ? [] : C.filter((k) => l.paint?.[k] !== undefined);
//     if (p.length) console.log(`  [${q(l.id)}, ${q(l.type)}, { ${p.map((k) => `${cc(k)}: ${q(l.paint[k])}`).join(', ')} }],`);
//   }

/** grupo de cor da camada (o retorno do antigo classifyLayer) */
export type BaseKind =
  | 'bg'
  | 'water'
  | 'park'
  | 'landuse'
  | 'building'
  | 'roadCase'
  | 'highway'
  | 'primary'
  | 'secondary'
  | 'road'
  | 'symbol';

export type BaseLayerType = 'background' | 'fill' | 'line' | 'symbol';

/** camadas que o applyTheme recoloria, na ordem do estilo: [id, tipo, grupo] */
// prettier-ignore
export const STREETS_V12_LAYERS: ReadonlyArray<readonly [id: string, type: BaseLayerType, kind: BaseKind]> = [
  ['land', 'background', 'bg'],
  ['landcover', 'fill', 'landuse'],
  ['national-park', 'fill', 'park'],
  ['landuse', 'fill', 'landuse'],
  ['water-shadow', 'fill', 'water'],
  ['water', 'fill', 'water'],
  ['building', 'fill', 'building'],
  ['building-underground', 'fill', 'building'],
  ['tunnel-minor-case', 'line', 'roadCase'],
  ['tunnel-street-case', 'line', 'roadCase'],
  ['tunnel-minor-link-case', 'line', 'roadCase'],
  ['tunnel-secondary-tertiary-case', 'line', 'roadCase'],
  ['tunnel-primary-case', 'line', 'roadCase'],
  ['tunnel-major-link-case', 'line', 'roadCase'],
  ['tunnel-motorway-trunk-case', 'line', 'roadCase'],
  ['tunnel-path', 'line', 'road'],
  ['tunnel-steps', 'line', 'road'],
  ['tunnel-pedestrian', 'line', 'road'],
  ['tunnel-construction', 'line', 'road'],
  ['tunnel-minor', 'line', 'road'],
  ['tunnel-minor-link', 'line', 'road'],
  ['tunnel-major-link', 'line', 'road'],
  ['tunnel-street', 'line', 'road'],
  ['tunnel-street-low', 'line', 'road'],
  ['tunnel-secondary-tertiary', 'line', 'secondary'],
  ['tunnel-primary', 'line', 'primary'],
  ['tunnel-motorway-trunk', 'line', 'highway'],
  ['tunnel-oneway-arrow-blue', 'symbol', 'symbol'],
  ['tunnel-oneway-arrow-white', 'symbol', 'symbol'],
  ['ferry', 'line', 'road'],
  ['ferry-auto', 'line', 'road'],
  ['road-path-bg', 'line', 'road'],
  ['road-steps-bg', 'line', 'road'],
  ['road-pedestrian-case', 'line', 'roadCase'],
  ['road-path', 'line', 'road'],
  ['road-steps', 'line', 'road'],
  ['road-pedestrian', 'line', 'road'],
  ['golf-hole-line', 'line', 'road'],
  ['road-minor-case', 'line', 'roadCase'],
  ['road-street-case', 'line', 'roadCase'],
  ['road-minor-link-case', 'line', 'roadCase'],
  ['road-secondary-tertiary-case', 'line', 'roadCase'],
  ['road-primary-case', 'line', 'roadCase'],
  ['road-major-link-case', 'line', 'roadCase'],
  ['road-motorway-trunk-case', 'line', 'roadCase'],
  ['road-construction', 'line', 'road'],
  ['road-minor', 'line', 'road'],
  ['road-minor-link', 'line', 'road'],
  ['road-major-link', 'line', 'road'],
  ['road-street', 'line', 'road'],
  ['road-street-low', 'line', 'road'],
  ['road-secondary-tertiary', 'line', 'secondary'],
  ['road-primary', 'line', 'primary'],
  ['road-motorway-trunk', 'line', 'highway'],
  ['road-rail', 'line', 'road'],
  ['road-rail-tracks', 'line', 'road'],
  ['level-crossing', 'symbol', 'symbol'],
  ['road-oneway-arrow-blue', 'symbol', 'symbol'],
  ['road-oneway-arrow-white', 'symbol', 'symbol'],
  ['crosswalks', 'symbol', 'symbol'],
  ['bridge-path-bg', 'line', 'road'],
  ['bridge-steps-bg', 'line', 'road'],
  ['bridge-pedestrian-case', 'line', 'roadCase'],
  ['bridge-path', 'line', 'road'],
  ['bridge-steps', 'line', 'road'],
  ['bridge-pedestrian', 'line', 'road'],
  ['bridge-minor-case', 'line', 'roadCase'],
  ['bridge-street-case', 'line', 'roadCase'],
  ['bridge-minor-link-case', 'line', 'roadCase'],
  ['bridge-secondary-tertiary-case', 'line', 'roadCase'],
  ['bridge-primary-case', 'line', 'roadCase'],
  ['bridge-major-link-case', 'line', 'roadCase'],
  ['bridge-motorway-trunk-case', 'line', 'roadCase'],
  ['bridge-construction', 'line', 'road'],
  ['bridge-minor', 'line', 'road'],
  ['bridge-minor-link', 'line', 'road'],
  ['bridge-major-link', 'line', 'road'],
  ['bridge-street', 'line', 'road'],
  ['bridge-street-low', 'line', 'road'],
  ['bridge-secondary-tertiary', 'line', 'secondary'],
  ['bridge-primary', 'line', 'primary'],
  ['bridge-motorway-trunk', 'line', 'highway'],
  ['bridge-major-link-2-case', 'line', 'roadCase'],
  ['bridge-motorway-trunk-2-case', 'line', 'roadCase'],
  ['bridge-major-link-2', 'line', 'road'],
  ['bridge-motorway-trunk-2', 'line', 'highway'],
  ['bridge-oneway-arrow-blue', 'symbol', 'symbol'],
  ['bridge-oneway-arrow-white', 'symbol', 'symbol'],
  ['bridge-rail', 'line', 'road'],
  ['bridge-rail-tracks', 'line', 'road'],
  ['aerialway', 'line', 'road'],
  ['building-entrance', 'symbol', 'symbol'],
  ['building-number-label', 'symbol', 'symbol'],
  ['block-number-label', 'symbol', 'symbol'],
  ['road-label', 'symbol', 'symbol'],
  ['road-intersection', 'symbol', 'symbol'],
  ['road-number-shield', 'symbol', 'symbol'],
  ['road-exit-shield', 'symbol', 'symbol'],
  ['path-pedestrian-label', 'symbol', 'symbol'],
  ['golf-hole-label', 'symbol', 'symbol'],
  ['ferry-aerialway-label', 'symbol', 'symbol'],
  ['waterway-label', 'symbol', 'symbol'],
  ['natural-line-label', 'symbol', 'symbol'],
  ['natural-point-label', 'symbol', 'symbol'],
  ['water-line-label', 'symbol', 'symbol'],
  ['water-point-label', 'symbol', 'symbol'],
  ['poi-label', 'symbol', 'symbol'],
  ['transit-label', 'symbol', 'symbol'],
  ['airport-label', 'symbol', 'symbol'],
  ['settlement-subdivision-label', 'symbol', 'symbol'],
  ['settlement-minor-label', 'symbol', 'symbol'],
  ['settlement-major-label', 'symbol', 'symbol'],
  ['state-label', 'symbol', 'symbol'],
  ['country-label', 'symbol', 'symbol'],
  ['continent-label', 'symbol', 'symbol'],
];

/** primeira line da source-layer 'road': o neon (cz-glow-*) entra logo abaixo dela, por baixo de todas as ruas */
export const FIRST_ROAD_LAYER_ID = 'tunnel-minor-case';
/** primeiro symbol com text-field: os prédios 3D (cz-3d) entram abaixo dele, sem cobrir os rótulos */
export const FIRST_LABEL_LAYER_ID = 'building-entrance';

/** cor como está no estilo: literal CSS ('hsl(...)', 'hsla(...)') ou expressão (arrays aninhados) */
export type StyleColorExpr = string | number | boolean | readonly StyleColorExpr[];

export type UnthemedColorProp =
  | 'fillColor'
  | 'fillOutlineColor'
  | 'lineColor'
  | 'circleColor'
  | 'circleStrokeColor';

export type UnthemedPaint = Readonly<Partial<Record<UnthemedColorProp, StyleColorExpr>>>;

/**
 * Camadas que o applyTheme NÃO recoloria (classifyLayer = null) mas que a luz 3D escurecia do mesmo jeito: pontos de
 * retorno brancos (turning-feature), áreas de rua e calçadões, píeres, aeroporto, rios, divisas. Guardam as cores
 * originais do estilo (props já em camelCase do rnmapbox) para o BaseTheme assar a luz nelas; sem isso elas ficariam
 * brancas no mapa escuro da noite.
 */
// prettier-ignore
export const STREETS_V12_UNTHEMED: ReadonlyArray<readonly [id: string, type: 'fill' | 'line' | 'circle', paint: UnthemedPaint]> = [
  ['pitch-outline', 'line', { lineColor: 'hsl(100, 65%, 75%)' }],
  ['waterway-shadow', 'line', { lineColor: 'hsl(219, 100%, 79%)' }],
  ['waterway', 'line', { lineColor: 'hsl(200, 100%, 80%)' }],
  ['water-depth', 'fill', { fillColor: ['interpolate', ['linear'], ['zoom'], 6, ['interpolate', ['linear'], ['get', 'min_depth'], 0, 'hsla(200, 100%, 80%, 0.35)', 200, 'hsla(200, 100%, 72%, 0.35)', 7000, 'hsla(200, 100%, 64%, 0.35)'], 8, ['interpolate', ['linear'], ['get', 'min_depth'], 0, 'hsla(200, 100%, 80%, 0)', 200, 'hsla(200, 100%, 72%, 0)', 7000, 'hsla(200, 100%, 60%, 0)']] }],
  ['hillshade', 'fill', { fillColor: ['interpolate', ['linear'], ['zoom'], 14, ['match', ['get', 'class'], 'shadow', 'hsla(40, 41%, 21%, 0.06)', 'hsla(20, 20%, 100%, 0.12)'], 16, ['match', ['get', 'class'], 'shadow', 'hsla(40, 41%, 21%, 0)', 'hsla(20, 20%, 100%, 0)']] }],
  ['land-structure-polygon', 'fill', { fillColor: ['interpolate', ['linear'], ['zoom'], 9, 'hsl(20, 20%, 95%)', 11, 'hsl(20, 18%, 91%)'] }],
  ['land-structure-line', 'line', { lineColor: ['interpolate', ['linear'], ['zoom'], 9, 'hsl(20, 20%, 95%)', 11, 'hsl(20, 18%, 91%)'] }],
  ['aeroway-polygon', 'fill', { fillColor: 'hsl(225, 52%, 87%)' }],
  ['aeroway-line', 'line', { lineColor: 'hsl(225, 52%, 87%)' }],
  ['road-pedestrian-polygon-fill', 'fill', { fillColor: 'hsl(20, 20%, 94%)' }],
  ['road-polygon', 'fill', { fillColor: 'hsl(0, 0%, 100%)', fillOutlineColor: 'hsl(220, 20%, 85%)' }],
  ['turning-feature-outline', 'circle', { circleColor: 'hsl(0, 0%, 100%)', circleStrokeColor: 'hsl(220, 20%, 85%)' }],
  ['turning-feature', 'circle', { circleColor: 'hsl(0, 0%, 100%)' }],
  ['admin-1-boundary-bg', 'line', { lineColor: 'hsl(240, 100%, 100%)' }],
  ['admin-0-boundary-bg', 'line', { lineColor: 'hsl(240, 100%, 100%)' }],
  ['admin-1-boundary', 'line', { lineColor: 'hsl(240, 50%, 65%)' }],
  ['admin-0-boundary', 'line', { lineColor: 'hsl(240, 50%, 60%)' }],
  ['admin-0-boundary-disputed', 'line', { lineColor: 'hsl(240, 50%, 60%)' }],
];
