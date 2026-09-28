// Utilitários puros do caminho quente de localização (atualização de posição + descoberta).
//
// Contexto: teste de carga com ~40 mil pessoas espalhadas por Uberlândia, com aglomerações de alguns milhares
// (show, faculdade, shopping). Nada aqui decide privacidade — só evita trabalho repetido (cache com poda
// incremental, cargas agrupadas, fila com teto, seleção parcial em vez de ordenar milhares).
import { distanceMeters } from '@cruzei/shared-utils';

/** divide em pedaços de até `size` (consultas com IN grande estouram o limite de 32.767 parâmetros do Postgres) */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error('chunk size must be >= 1');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** a fila de uma vaga limitada encheu (ou alguém esperou demais): quem chama responde 503 em vez de empilhar */
export class SaturatedError extends Error {
  constructor(readonly reason: 'queue_full' | 'wait_timeout') {
    super(`saturated: ${reason}`);
    this.name = 'SaturatedError';
  }
}

interface Waiter {
  resolve: () => void;
  reject: (e: Error) => void;
  since: number;
}

/**
 * Semáforo com fila: no máximo `max` tarefas ao mesmo tempo. Opcionalmente com teto de fila (`maxQueue`,
 * recusa na hora) e tempo máximo de espera (`maxWaitMs`, quem esperou demais é recusado quando chega a vez —
 * o cliente já desistiu, calcular a resposta só atrasaria quem ainda está esperando).
 */
export class Semaphore {
  private active = 0;
  private readonly queue: Waiter[] = [];

  constructor(
    private readonly max: number,
    private readonly opts: { maxQueue?: number; maxWaitMs?: number; now?: () => number } = {},
  ) {
    if (max < 1) throw new Error('semaphore max must be >= 1');
  }

  get inUse(): number {
    return this.active;
  }

  get waiting(): number {
    return this.queue.length;
  }

  acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    if (this.opts.maxQueue != null && this.queue.length >= this.opts.maxQueue) return Promise.reject(new SaturatedError('queue_full'));
    const since = (this.opts.now ?? Date.now)();
    return new Promise<void>((resolve, reject) => this.queue.push({ resolve, reject, since }));
  }

  release(): void {
    const now = (this.opts.now ?? Date.now)();
    while (this.queue.length > 0) {
      const w = this.queue.shift()!;
      if (this.opts.maxWaitMs != null && now - w.since > this.opts.maxWaitMs) {
        w.reject(new SaturatedError('wait_timeout'));
        continue;
      }
      w.resolve(); // a vaga passa direto pra quem espera (active não muda)
      return;
    }
    this.active--;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

/**
 * Cache com validade fixa e poda INCREMENTAL. Toda escrita reinsere a chave no fim do Map, então a ordem de
 * iteração é (quase) a ordem de escrita: a poda anda do começo e para no primeiro item ainda válido — nunca
 * varre o mapa inteiro. `at` pode vir um pouco fora de ordem (cargas concorrentes carimbam o início da consulta);
 * no pior caso um item vencido espera alguns ms a mais pra sair.
 */
export class ExpiringCache<K, V> {
  private readonly map = new Map<K, { v: V; at: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxSize = Number.POSITIVE_INFINITY,
  ) {}

  get size(): number {
    return this.map.size;
  }

  get(key: K, now = Date.now()): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (now - e.at >= this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    return e.v;
  }

  set(key: K, value: V, at = Date.now()): void {
    this.map.delete(key);
    this.map.set(key, { v: value, at });
    if (this.map.size > this.maxSize) this.evictOldest(this.map.size - this.maxSize);
  }

  delete(key: K): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  /** remove vencidos a partir dos mais antigos; para no primeiro válido ou quando o orçamento acaba. Devolve quantos saíram. */
  prune(now = Date.now(), budget = 1_000): number {
    let removed = 0;
    for (const [k, e] of this.map) {
      if (removed >= budget || now - e.at < this.ttlMs) break;
      this.map.delete(k);
      removed++;
    }
    return removed;
  }

  private evictOldest(n: number): void {
    for (const k of this.map.keys()) {
      if (n-- <= 0) break;
      this.map.delete(k);
    }
  }
}

/**
 * Memo com validade e "single-flight": enquanto um valor é recalculado, quem chega junto espera a MESMA promessa
 * (sem manada de consultas iguais quando o cache vence). Falha não fica em cache. Valores vencidos saem aos poucos a
 * cada carga (poda incremental a partir do mais antigo): com validade de 2 s e milhares de células visitadas, segurar
 * o valor até bater o teto de chaves era segurar centenas de MB de mapas de presença velhos por processo.
 */
export class TtlMemo<K, V> {
  private readonly values = new Map<K, { v: V; at: number }>();
  private readonly inflight = new Map<K, Promise<V>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxKeys = 1_000,
  ) {}

  get size(): number {
    return this.values.size;
  }

  get(key: K, loader: () => Promise<V>, now = Date.now()): Promise<V> {
    const hit = this.values.get(key);
    if (hit && now - hit.at < this.ttlMs) return Promise.resolve(hit.v);
    const running = this.inflight.get(key);
    if (running) return running;
    const p = loader().then((v) => {
      // chave vinda do cliente (ex.: cidade): o mapa nunca cresce sem limite
      if (this.values.size >= this.maxKeys && !this.values.has(key)) this.values.clear();
      const at = Date.now();
      this.values.delete(key); // reinsere no fim: a ordem do Map fica (quase) a ordem de gravação
      this.values.set(key, { v, at });
      this.prune(at);
      return v;
    });
    this.inflight.set(key, p);
    const clear = () => {
      if (this.inflight.get(key) === p) this.inflight.delete(key);
    };
    p.then(clear, clear);
    return p;
  }

  /** descarta o valor guardado: a próxima leitura recarrega (uma carga em andamento continua valendo pra quem já espera) */
  invalidate(key: K): void {
    this.values.delete(key);
  }

  private prune(now: number, budget = 64): void {
    for (const [k, e] of this.values) {
      if (budget-- <= 0 || now - e.at < this.ttlMs) break;
      this.values.delete(k);
    }
  }
}

/**
 * Os `k` menores segundo `cmp`, já ordenados, sem ordenar a lista inteira: seleção (quickselect de 3 vias com pivô
 * aleatório — nomes repetidos não degeneram) + ordenação só do prefixo. Mesma ordem que `items.sort(cmp).slice(0, k)`
 * a menos de empates exatos (que ali também saem em ordem arbitrária). Não altera `items`.
 */
export function selectTop<T>(items: readonly T[], k: number, cmp: (a: T, b: T) => number): { top: T[]; rest: number } {
  const n = items.length;
  if (k <= 0) return { top: [], rest: n };
  const a = items.slice();
  if (n > k) {
    let lo = 0;
    let hi = n - 1;
    // invariante: tudo à esquerda de [lo, hi] é <= tudo dentro, e tudo à direita é >=; a janela sempre contém a posição k-1
    while (lo < hi) {
      const pivot = a[lo + Math.floor(Math.random() * (hi - lo + 1))];
      // partição de 3 vias (Dijkstra): [lo, lt) < pivô, [lt, gt] == pivô, (gt, hi] > pivô
      let lt = lo;
      let gt = hi;
      let i = lo;
      while (i <= gt) {
        const c = cmp(a[i], pivot);
        if (c < 0) {
          const t = a[lt];
          a[lt] = a[i];
          a[i] = t;
          lt++;
          i++;
        } else if (c > 0) {
          const t = a[gt];
          a[gt] = a[i];
          a[i] = t;
          gt--;
        } else i++;
      }
      const target = k - 1;
      if (target < lt) hi = lt - 1;
      else if (target > gt) lo = gt + 1;
      else break; // a posição k-1 caiu no bloco igual ao pivô: tudo antes dela já é <=
    }
    a.length = k;
  }
  a.sort(cmp);
  return { top: a, rest: Math.max(0, n - k) };
}

/** Presença mínima que a triagem da descoberta precisa (a real, interna — nunca vai pro cliente). */
export interface PresenceLite {
  lat: number;
  lng: number;
  hidden: boolean;
  poi: { id: number } | null;
}

export interface DiscoveryTriage {
  /** distância REAL (m) de quem está dentro do raio — candidatos a aparecer */
  inRadius: Map<string, number>;
  /** célula de anonimato (área) de cada presença não oculta — calculada uma vez só */
  areaOf: Map<string, string>;
  /** ids que precisam de linha de perfil: os do raio + todos que entram nas contagens que o raio vai consultar */
  needed: string[];
}

/**
 * Triagem da descoberta ANTES de carregar perfis. As contagens de anonimato (pessoas visíveis por área e por lugar)
 * só são LIDAS pras áreas e lugares de quem está no raio — então só essas precisam ser contadas, mas contadas
 * INTEIRAS (todo mundo das 9 células que cai nelas), pra dar exatamente o mesmo número que a contagem sobre todos.
 * Presença oculta (área privada/residência) não entra em nada: não é elegível nem conta pro piso.
 */
export function triageForDiscovery<P extends PresenceLite>(
  center: { lat: number; lng: number },
  radiusM: number,
  presences: ReadonlyMap<string, P>,
  /** célula de anonimato da presença (recebe o objeto: quem chama pode guardar o valor nele) */
  areaCell: (p: P) => string,
  /** quem está consultando: fica fora de tudo (não se vê e não conta pro próprio piso) */
  excludeId?: string,
): DiscoveryTriage {
  const inRadius = new Map<string, number>();
  const areaOf = new Map<string, string>();
  const areas = new Set<string>();
  const places = new Set<number>();
  // caixa um pouco MAIOR que o círculo (2% de folga, cosseno na borda mais perto do polo): quem está fora dela está
  // fora do raio com certeza e dispensa o haversine (numa região com milhares de presenças, a maioria cai fora)
  const dLat = (radiusM / 111_195) * 1.02;
  const dLng = dLat / Math.max(0.01, Math.cos(((Math.abs(center.lat) + dLat) * Math.PI) / 180));
  for (const [id, p] of presences) {
    if (p.hidden || id === excludeId) continue;
    const area = areaCell(p);
    areaOf.set(id, area);
    if (Math.abs(p.lat - center.lat) > dLat || Math.abs(p.lng - center.lng) > dLng) continue;
    const d = distanceMeters(center.lat, center.lng, p.lat, p.lng);
    if (d <= radiusM) {
      inRadius.set(id, d);
      areas.add(area);
      if (p.poi) places.add(p.poi.id);
    }
  }
  const needed: string[] = [];
  for (const [id, area] of areaOf) {
    if (inRadius.has(id) || areas.has(area)) {
      needed.push(id);
      continue;
    }
    const poi = presences.get(id)!.poi;
    if (poi && places.has(poi.id)) needed.push(id);
  }
  return { inRadius, areaOf, needed };
}

/** residência aprendida: alguma célula de casa é a atual ou vizinha dela */
export function matchesHomeCells(homeCells: readonly string[], around: readonly string[]): boolean {
  if (homeCells.length === 0) return false;
  const set = new Set(around);
  return homeCells.some((c) => set.has(c));
}

/**
 * Assinatura de uma linha do histórico grosseiro: se a próxima atualização gera a MESMA linha (mesma grade de
 * ~110 m, mesmo lugar, mesma flag de anonimato), a gravação pode ser pulada por alguns minutos — quem está parado
 * não precisa de uma linha nova a cada 20 s.
 */
export function historySignature(r: {
  latitude: number;
  longitude: number;
  geohash: string;
  poiId: number | null;
  city?: string | null;
  state?: string | null;
  isAnonymous: boolean;
}): string {
  return [r.latitude, r.longitude, r.geohash, r.poiId ?? '', r.city ?? '', r.state ?? '', r.isAnonymous ? 1 : 0].join('|');
}

/**
 * Recarga INCREMENTAL de uma célula de presença. O ZSET presence:<célula> tem como score o horário da última
 * atualização de cada pessoa (toda atualização regrava o hash e o score juntos, no mesmo script): quem tem o MESMO
 * score da carga anterior não mudou e a presença já lida é reaproveitada; só os novos/alterados voltam ao Redis.
 * Quem saiu da célula some do ZSET (sai também daqui); score mais velho que `minScore` = presença vencida (ignorada).
 * `raw` = resposta do ZRANGE ... WITHSCORES ([id, score, id, score, ...]).
 */
export function planCellReload<P>(
  raw: readonly string[],
  prev: { scores: ReadonlyMap<string, number>; pres: ReadonlyMap<string, P> } | undefined,
  minScore: number,
): { scores: Map<string, number>; keep: Map<string, P>; fetch: string[] } {
  const scores = new Map<string, number>();
  const keep = new Map<string, P>();
  const fetch: string[] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const id = raw[i];
    const score = Number(raw[i + 1]);
    if (!(score >= minScore)) continue;
    scores.set(id, score);
    const old = prev && prev.scores.get(id) === score ? prev.pres.get(id) : undefined;
    if (old !== undefined) keep.set(id, old);
    else fetch.push(id);
  }
  return { scores, keep, fetch };
}
