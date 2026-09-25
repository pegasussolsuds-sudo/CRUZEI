// Fonte do wordmark (Space Grotesk Bold) carregada UMA vez como typeface do Skia e compartilhada.
// Por que não `useFont` do Skia em cada componente: ele carrega de forma assíncrona na thread JS,
// e no boot a thread JS fica ocupada montando o mapa — a splash chegava a sair antes da fonte existir.
import { Image } from 'react-native';
import { Skia, type SkTypeface } from '@shopify/react-native-skia';
import { SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';

let typeface: SkTypeface | null = null;
let failed = false;
let pending: Promise<SkTypeface | null> | null = null;

/** typeface já carregado (síncrono) ou null */
export function getBrandTypeface(): SkTypeface | null {
  return typeface;
}

/** true quando o carregamento falhou — os componentes caem pro <Text> comum */
export function brandTypefaceFailed(): boolean {
  return failed;
}

/**
 * Dispara o carregamento (idempotente). Chame cedo — em `useAppFonts` — pra que a splash
 * já nasça com o wordmark pronto. Nunca rejeita: falha vira `null` + `brandTypefaceFailed()`.
 */
export function preloadBrandTypeface(): Promise<SkTypeface | null> {
  if (typeface) return Promise.resolve(typeface);
  if (pending) return pending;
  pending = (async () => {
    try {
      const uri = Image.resolveAssetSource(SpaceGrotesk_700Bold)?.uri;
      if (!uri) throw new Error('asset da fonte sem uri');
      const data = await Skia.Data.fromURI(uri);
      const tf = Skia.Typeface.MakeFreeTypeFaceFromData(data);
      if (!tf) throw new Error('typeface inválido');
      typeface = tf;
    } catch (e) {
      failed = true;
      // eslint-disable-next-line no-console
      console.warn('fonte da marca não carregou, usando texto comum:', (e as Error).message);
    }
    return typeface;
  })();
  return pending;
}
