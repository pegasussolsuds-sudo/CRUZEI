import { Directory, File, Paths } from 'expo-file-system';

// O app antigo usava o SDK do Mapbox, que deixava ~7 MB no aparelho: cache de tiles em files/.mapbox,
// cache/.mapbox e as configurações em shared_prefs/mapbox_settings.xml. Com o MapLibre ninguém lê isso.
// NÃO apaga shared_prefs/MapboxSharedPreferences.xml: apesar do nome, é do próprio MapLibre (herança do fork).
let done = false;

export function cleanupLegacyMapbox(): void {
  if (done) return;
  done = true;
  const targets: (Directory | File)[] = [
    new Directory(Paths.document, '.mapbox'),
    new Directory(Paths.cache, '.mapbox'),
    new File(Paths.document.parentDirectory, 'shared_prefs', 'mapbox_settings.xml'),
  ];
  for (const t of targets) {
    try {
      if (t.exists) t.delete();
    } catch {
      /* sem permissão ou já apagado: segue */
    }
  }
}
