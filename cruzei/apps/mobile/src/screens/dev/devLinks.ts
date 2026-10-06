// Links de desenvolvimento (só __DEV__): metch://dev/avatar-gallery?slot=hat&mode=tiles&page=0&p=0
// Deixa revisar a galeria do avatar no aparelho pelo adb, sem tocar na tela.

import { useEffect } from 'react';
import { Linking } from 'react-native';
import { StackActions } from '@react-navigation/native';

import { navigationRef } from '../../navigation/navigationRef';

function parse(url: string | null): Record<string, string> | null {
  if (!url || !url.startsWith('metch://dev/avatar-gallery')) return null;
  const out: Record<string, string> = {};
  // forma por caminho (o '&' da query se perde no `adb shell am start`): .../avatar-gallery/<slot>/<mode>/<page>/<p>/<id>
  const segs = url.split('?')[0].replace('metch://dev/avatar-gallery', '').split('/').filter(Boolean);
  ['slot', 'mode', 'page', 'p', 'id'].forEach((k, i) => {
    if (segs[i]) out[k] = decodeURIComponent(segs[i]);
  });
  const q = url.split('?')[1] ?? '';
  for (const part of q.split('&')) {
    if (!part) continue;
    const [k, v = ''] = part.split('=');
    out[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  return out;
}

function open(url: string | null): void {
  const params = parse(url);
  if (!params) return;
  const go = () => {
    if (!navigationRef.isReady()) {
      setTimeout(go, 300);
      return;
    }
    const next = {
      ...params,
      page: params.page != null ? Number(params.page) : undefined,
      p: params.p != null ? Number(params.p) : undefined,
    };
    // já na galeria: SUBSTITUI a tela (empilhar uma por link estourou a memória do Java depois de ~10 páginas)
    if (navigationRef.getCurrentRoute()?.name === 'AvatarGallery') navigationRef.dispatch(StackActions.replace('AvatarGallery', next));
    else (navigationRef as unknown as { navigate: (name: string, p: object) => void }).navigate('AvatarGallery', next);
  };
  go();
}

/** escuta os links de desenvolvimento enquanto a pessoa está logada (no-op fora de __DEV__) */
export function useDevLinks(enabled: boolean): void {
  useEffect(() => {
    if (!__DEV__ || !enabled) return;
    Linking.getInitialURL().then(open).catch(() => {});
    const sub = Linking.addEventListener('url', (e) => open(e.url));
    return () => sub.remove();
  }, [enabled]);
}
