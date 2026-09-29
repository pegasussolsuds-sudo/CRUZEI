// Feature-state por fonte GeoJSON: API do PR maplibre-react-native#1651 (GeoJSONSourceRef.setFeatureState({id}, state)),
// trazida pelo patch (patches/@maplibre__maplibre-react-native@11.4.0.patch), mais o lote setFeatureStates (só nosso).
// Os pedidos de um mesmo turno do JS (um tick do relógio mexe em dezenas de fades) viram UMA chamada nativa por fonte.
// Sem o método (MLRN sem o patch), não faz nada (o estilo cai no coalesce → 1) e loga uma vez.

import type { GeoJSONSourceRef } from '@maplibre/maplibre-react-native';

/** o motor só guarda números no feature-state ('a', 'pa') */
export type FeatureStateValues = { [key: string]: number };

let warned = false;

function hasApi(src: GeoJSONSourceRef): boolean {
  if (typeof (src as Partial<GeoJSONSourceRef>).setFeatureState === 'function') return true;
  if (!warned) {
    warned = true;
    // eslint-disable-next-line no-console
    console.warn('[map] MLRN sem setFeatureState (patch do PR #1651 não aplicado): fades desligados');
  }
  return false;
}

export class FeatureStateQueue {
  private readonly pending = new Map<string, Map<string | number, FeatureStateValues>>();
  private scheduled = false;

  constructor(private readonly sourceOf: (source: string) => GeoJSONSourceRef | null) {}

  /**
   * Enfileira o estado da feature `id` na fonte (as chaves se somam até o envio). Nunca lança. Fonte ainda não montada:
   * descarta (o motor reaplica quando precisa). Devolve false só se a fonte existe e o MLRN não tem a API.
   */
  set(source: string, id: string | number, state: FeatureStateValues): boolean {
    const src = this.sourceOf(source);
    if (!src) return true;
    if (!hasApi(src)) return false;
    let m = this.pending.get(source);
    if (!m) {
      m = new Map();
      this.pending.set(source, m);
    }
    const prev = m.get(id);
    m.set(id, prev ? { ...prev, ...state } : state);
    if (!this.scheduled) {
      this.scheduled = true;
      void Promise.resolve().then(() => this.flush());
    }
    return true;
  }

  /** manda o que está na fila: uma chamada por fonte (fonte fora do mapa: o nativo rejeita com source_not_attached) */
  flush(): void {
    this.scheduled = false;
    if (!this.pending.size) return;
    const batch = Array.from(this.pending);
    this.pending.clear();
    for (const [source, m] of batch) {
      const src = this.sourceOf(source);
      if (!src || !m.size) continue;
      const entries = Array.from(m, ([id, state]) => ({ id, state }));
      try {
        const p =
          typeof (src as Partial<GeoJSONSourceRef>).setFeatureStates === 'function'
            ? src.setFeatureStates(entries)
            : Promise.all(entries.map((e) => src.setFeatureState({ id: e.id }, e.state)));
        p.catch(() => {});
      } catch {
        /* fonte desmontando: ignora */
      }
    }
  }

  clear(): void {
    this.pending.clear();
  }
}
