/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */
// Skia em node pra folha de contato: CanvasKit (canvaskit-wasm, CPU) por trás da MESMA API do @shopify/react-native-skia
// (implementação web JsiSkApi). Com isso a folha desenha pelo código de verdade do raster do mapa (images/draw.ts) e
// pela gravação de SkPictures do palco (stage/assets.ts), sem aparelho.
//
// installSkia() troca, só neste processo, os módulos '@shopify/react-native-skia' e 'react-native' por calços:
// Skia = JsiSkApi(CanvasKit) + enums; react-native = { PixelRatio.get() → 2 } (IMG_SCALE do mapa = 2).

import * as path from 'path';

let installed: Promise<any> | null = null;

/** uma instância só por processo, mesmo com várias células pedindo ao mesmo tempo (CanvasKit duplicado quebra os paths) */
export function installSkia(): Promise<any> {
  if (!installed) installed = load();
  return installed;
}

async function load(): Promise<any> {
  const ckPath = require.resolve('canvaskit-wasm/bin/canvaskit.js');
  const CanvasKitInit = require(ckPath);
  const CK = await CanvasKitInit({ locateFile: (f: string) => path.join(path.dirname(ckPath), f) });
  const types = require('@shopify/react-native-skia/lib/commonjs/skia/types');
  const { JsiSkApi } = require('@shopify/react-native-skia/lib/commonjs/skia/web/JsiSkia');
  const Skia = JsiSkApi(CK);
  const skiaShim = { ...types, Skia };
  const rnShim = { PixelRatio: { get: () => 2 }, Platform: { OS: 'android', select: (o: any) => o.android ?? o.default } };
  const Module = require('module');
  const orig = Module._load;
  Module._load = function load(request: string, ...rest: any[]) {
    if (request === '@shopify/react-native-skia') return skiaShim;
    if (request === 'react-native') return rnShim;
    return orig.call(this, request, ...rest);
  };
  return Skia;
}
