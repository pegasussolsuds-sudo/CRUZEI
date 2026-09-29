// Cache das imagens do mapa nativo em disco, endereçado por conteúdo.
// O motor pede cada imagem por uma CHAVE estável que descreve tudo o que muda o desenho
// (ex.: 'fig|<avatarKey>|<sig>|pose...|v3'); o store devolve o PNG no disco pro <Images> do MLRN.
//   - Por que disco: o <Images> do Android só carrega imagem por URI (Fresco). De brinde o arquivo sobrevive
//     entre sessões — a segunda abertura do mapa quase não desenha nada.
//   - Por que o nome é hash da chave: o Fresco guarda o bitmap pela URI; conteúdo novo precisa de nome novo.
//   - Os desenhos (Skia raster, CPU) rodam na thread JS em fatias com orçamento de tempo, cedendo com
//     setTimeout(0) entre fatias, pra não travar o motor nem as animações.
// Nunca lança exceção pra fora: falha vira null (e um console.warn só em __DEV__).

import { Directory, File, Paths } from 'expo-file-system';

import { IMG_SCALE, type MapImageRef } from '../contracts';

/** pasta dentro do cache do app (o sistema pode limpar quando faltar espaço); mude o sufixo se o nome mudar */
const DIR_NAME = 'mapimg-v1';
const DEFAULT_BUDGET_MS = 8;
/** limites da pasta: passou disso, a limpeza apaga os mais antigos até ~75% (pra não limpar de novo logo) */
const MAX_FILES = 4000;
const MAX_BYTES = 80 * 1024 * 1024;
const TRIM_TO = 0.75;
/** a limpeza espera o boot do mapa assentar antes de mexer no disco */
const CLEANUP_DELAY_MS = 5000;
/** prioridade de quem não disse nenhuma: fim da fila */
const LOW_PRIORITY = 1e9;
/** chave cujo render/escrita falhou resolve null na hora por um tempo: o motor repede a cada quadro */
const FAIL_RETRY_MS = 5000;

/** estatística simples pro log de __DEV__ */
export interface ImageStoreStats {
  /** renders executados (inclui os que falharam) */
  renders: number;
  /** ms médio / máximo só do desenho */
  avgMs: number;
  maxMs: number;
  /** ms médio da escrita no disco */
  writeAvgMs: number;
  /** imagens reaproveitadas de sessão anterior (sem desenhar) */
  diskHits: number;
  /** render null/erro ou escrita que falhou */
  failed: number;
  /** pedidos esperando na fila agora */
  queued: number;
  /** imagens registradas em memória */
  ready: number;
  /** fatias do agendador */
  slices: number;
}

interface Job {
  key: string;
  name: string;
  priority: number;
  /** desempate: mesma prioridade roda na ordem em que chegou */
  seq: number;
  render: () => Uint8Array | null;
  scale: number;
  promise: Promise<MapImageRef | null>;
  resolve: (ref: MapImageRef | null) => void;
}

interface DirRecord {
  isDirectory: boolean;
  uri: string;
}

interface FileStat {
  name: string;
  mtime: number;
  size: number;
}

const perf = (globalThis as { performance?: { now(): number } }).performance;
const now: () => number =
  perf && typeof perf.now === 'function' ? () => perf.now() : () => Date.now();

function warn(msg: string, e?: unknown): void {
  if (!__DEV__) return;
  const detail = e === undefined ? '' : ': ' + (e instanceof Error ? e.message : String(e));
  // eslint-disable-next-line no-console
  console.warn('[mapimg] ' + msg + detail);
}

function hex8(h: number): string {
  return (h >>> 0).toString(16).padStart(8, '0');
}

const FNV_PRIME = 0x01000193;

/**
 * Nome do arquivo de uma chave: dois FNV-1a de 32 bits (um de trás pra frente, com outra base) + tamanho da
 * chave em base 36. Colisão dos três juntos é, na prática, impossível no nosso volume.
 */
export function mapImageFileName(key: string): string {
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  const n = key.length;
  for (let i = 0; i < n; i++) {
    a = Math.imul(a ^ key.charCodeAt(i), FNV_PRIME);
    b = Math.imul(b ^ key.charCodeAt(n - 1 - i), FNV_PRIME);
  }
  return hex8(a) + hex8(b) + '-' + n.toString(36) + '.png';
}

/** 'file:///data/.../x.png' → '/data/.../x.png' (o DownloadMapImageTask do MLRN vira caminho com '/' em file:// e carrega pelo Fresco) */
function toPath(uri: string): string {
  let p = uri.startsWith('file://') ? uri.slice(7) : uri;
  try {
    p = decodeURIComponent(p);
  } catch {
    // já vinha sem escape
  }
  return p;
}

function baseName(uri: string): string {
  const u = uri.endsWith('/') ? uri.slice(0, -1) : uri;
  const n = u.slice(u.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(n);
  } catch {
    return n;
  }
}

function isPng(name: string): boolean {
  return name.endsWith('.png');
}

function listRecords(dir: Directory): DirRecord[] {
  // listAsRecords é uma chamada nativa só; list() cria um objeto File (com validação nativa) por arquivo
  if (typeof dir.listAsRecords === 'function') return dir.listAsRecords();
  return dir.list().map((it) => ({ isDirectory: it instanceof Directory, uri: it.uri }));
}

export class ImageStore {
  private readonly refs = new Map<string, MapImageRef>();
  private readonly pending = new Map<string, Job>();
  /** ordenada da MAIOR prioridade (número) pra menor: o próximo a rodar sai do fim com pop() */
  private queue: Job[] = [];
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private budgetMs = DEFAULT_BUDGET_MS;
  private seq = 0;

  private disk: 'closed' | 'open' | 'broken' = 'closed';
  private dir: Directory | null = null;
  /** caminho absoluto da pasta, sem file://, terminado em '/' */
  private dirPath = '';
  /** nomes .png na pasta (listagem inicial + o que escrevemos); null = listagem falhou, pergunta arquivo a arquivo */
  private onDisk: Set<string> | null = null;
  /** nomes entregues nesta sessão: a limpeza nunca apaga (o mapa relê o arquivo se recarregar o estilo) */
  private readonly live = new Set<string>();
  /** chave -> quando falhou (render null/erro ou escrita) */
  private readonly failedAt = new Map<string, number>();

  private renders = 0;
  private renderMs = 0;
  private maxRenderMs = 0;
  private writes = 0;
  private writeMs = 0;
  private failed = 0;
  private diskHits = 0;
  private slices = 0;

  /**
   * Imagem já pronta (só memória, síncrono, sem I/O). Depois que a pasta foi listada (no primeiro request),
   * um arquivo de sessão anterior também conta como pronto — a listagem está em memória.
   */
  get(key: string): MapImageRef | undefined {
    const ready = this.refs.get(key);
    if (ready || this.disk !== 'open' || !this.onDisk || this.pending.has(key)) return ready;
    const name = mapImageFileName(key);
    return this.onDisk.has(name) ? this.register(key, name, IMG_SCALE, true) : undefined;
  }

  /**
   * Garante a imagem da chave. Já em memória: resolve na hora. Arquivo de sessão anterior: registra sem
   * desenhar. Senão enfileira o render (prioridade menor = antes). Pedidos simultâneos da mesma chave
   * compartilham a mesma promise (vale o primeiro render; a prioridade fica a mais urgente).
   * Resolve null se o render falhar, a escrita falhar ou o pedido for cancelado — nunca rejeita. Chave que
   * falhou resolve null na hora por FAIL_RETRY_MS (evita redesenhar a cada quadro algo que não sai).
   */
  request(
    key: string,
    priority: number,
    render: () => Uint8Array | null,
    scale: number = IMG_SCALE,
  ): Promise<MapImageRef | null> {
    try {
      const ready = this.refs.get(key);
      if (ready) return Promise.resolve(ready);
      const pri = Number.isFinite(priority) ? priority : LOW_PRIORITY;
      const waiting = this.pending.get(key);
      if (waiting) {
        if (pri < waiting.priority) {
          waiting.priority = pri;
          this.dirty = true;
        }
        return waiting.promise;
      }
      const failed = this.failedAt.get(key);
      if (failed !== undefined) {
        if (Date.now() - failed < FAIL_RETRY_MS) return Promise.resolve(null);
        this.failedAt.delete(key);
      }
      // o primeiro pedido abre e lista a pasta (uma chamada nativa); daí em diante a checagem é em memória
      if (!this.openDisk()) return Promise.resolve(null);
      const name = mapImageFileName(key);
      // desenhada numa sessão anterior: nem entra na fila
      if (this.onDisk && this.onDisk.has(name))
        return Promise.resolve(this.register(key, name, scale, true));
      let resolve: (ref: MapImageRef | null) => void = () => {};
      const promise = new Promise<MapImageRef | null>((r) => {
        resolve = r;
      });
      const job: Job = {
        key,
        name,
        priority: pri,
        seq: this.seq++,
        render,
        scale,
        promise,
        resolve,
      };
      this.pending.set(key, job);
      this.queue.push(job);
      this.dirty = true;
      this.schedule();
      return promise;
    } catch (e) {
      warn('request ' + key, e);
      return Promise.resolve(null);
    }
  }

  /** muda a prioridade de quem ainda está na fila (ex.: entrou no centro da tela) */
  reprioritize(key: string, priority: number): void {
    const job = this.pending.get(key);
    if (!job || !Number.isFinite(priority) || job.priority === priority) return;
    job.priority = priority;
    this.dirty = true;
  }

  /** tira da fila quem ainda não rodou (a promise resolve null); o que já está pronto fica */
  cancel(key: string): void {
    const job = this.pending.get(key);
    if (!job) return;
    this.pending.delete(key);
    job.resolve(null);
    // só sobrou pedido cancelado na fila: descarta de uma vez
    if (this.pending.size === 0) this.queue.length = 0;
  }

  /** orçamento (ms) de cada fatia do agendador; um render sempre roda inteiro, mesmo se passar */
  setBudget(ms: number): void {
    this.budgetMs = Number.isFinite(ms) ? Math.max(1, Math.min(50, ms)) : DEFAULT_BUDGET_MS;
  }

  stats(): ImageStoreStats {
    const round = (v: number): number => Math.round(v * 100) / 100;
    return {
      renders: this.renders,
      avgMs: this.renders ? round(this.renderMs / this.renders) : 0,
      maxMs: round(this.maxRenderMs),
      writeAvgMs: this.writes ? round(this.writeMs / this.writes) : 0,
      diskHits: this.diskHits,
      failed: this.failed,
      queued: this.pending.size,
      ready: this.refs.size,
      slices: this.slices,
    };
  }

  /** linha curta pro log de __DEV__ */
  describe(): string {
    const s = this.stats();
    return (
      `renders=${s.renders} média=${s.avgMs}ms máx=${s.maxMs}ms escrita=${s.writeAvgMs}ms ` +
      `disco=${s.diskHits} falhas=${s.failed} fila=${s.queued} prontas=${s.ready}`
    );
  }

  // ---- agendador ----

  private schedule(): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(this.pump, 0);
  }

  private readonly pump = (): void => {
    this.timer = null;
    this.slices++;
    const deadline = now() + this.budgetMs;
    while (this.queue.length > 0) {
      if (this.dirty) {
        this.queue.sort((a, b) => b.priority - a.priority || b.seq - a.seq);
        this.dirty = false;
      }
      const job = this.queue.pop();
      if (!job || this.pending.get(job.key) !== job) continue; // cancelado (ou repedido depois de cancelar)
      this.pending.delete(job.key);
      this.run(job);
      if (now() >= deadline) break;
    }
    if (this.queue.length > 0) this.schedule();
  };

  private run(job: Job): void {
    let ref: MapImageRef | null = null;
    try {
      if (this.openDisk()) {
        ref = this.existsOnDisk(job.name)
          ? this.register(job.key, job.name, job.scale, true)
          : this.renderAndWrite(job);
      }
    } catch (e) {
      warn('job ' + job.key, e);
      ref = null;
    }
    if (!ref && this.disk === 'open') {
      if (this.failedAt.size > 2000) this.failedAt.clear(); // só uma trava contra repetição, não histórico
      this.failedAt.set(job.key, Date.now());
    }
    job.resolve(ref);
  }

  private renderAndWrite(job: Job): MapImageRef | null {
    const dir = this.dir;
    if (!dir) return null;
    const t0 = now();
    let bytes: Uint8Array | null = null;
    try {
      bytes = job.render();
    } catch (e) {
      warn('render ' + job.key, e);
    }
    const t1 = now();
    this.renders++;
    this.renderMs += t1 - t0;
    if (t1 - t0 > this.maxRenderMs) this.maxRenderMs = t1 - t0;
    if (!bytes || bytes.length === 0) {
      this.failed++;
      return null;
    }
    try {
      writeAtomic(dir, job.name, bytes);
    } catch (e) {
      this.failed++;
      warn('escrita ' + job.name, e);
      return null;
    }
    this.writes++;
    this.writeMs += now() - t1;
    return this.register(job.key, job.name, job.scale, false);
  }

  private register(key: string, name: string, scale: number, fromDisk: boolean): MapImageRef {
    const ref: MapImageRef = { path: this.dirPath + name, scale };
    this.refs.set(key, ref);
    this.live.add(name);
    if (this.onDisk) this.onDisk.add(name);
    if (fromDisk) this.diskHits++;
    return ref;
  }

  private existsOnDisk(name: string): boolean {
    if (this.onDisk) return this.onDisk.has(name);
    try {
      return this.dir !== null && new File(this.dir, name).exists;
    } catch {
      return false;
    }
  }

  // ---- disco ----

  /**
   * Abre (e cria) a pasta e lista o que já existe, uma vez, no primeiro request — nunca no import (testes e
   * boot não pagam I/O só por importar o módulo).
   */
  private openDisk(): boolean {
    if (this.disk === 'open') return true;
    if (this.disk === 'broken') return false;
    try {
      const dir = new Directory(Paths.cache, DIR_NAME);
      let names: string[] | null = [];
      if (dir.exists) {
        try {
          names = listRecords(dir)
            .filter((r) => !r.isDirectory)
            .map((r) => baseName(r.uri));
        } catch (e) {
          names = null;
          warn('listagem da pasta', e);
        }
      } else {
        dir.create({ intermediates: true, idempotent: true });
      }
      this.dir = dir;
      this.dirPath = toPath(dir.uri).replace(/\/+$/, '') + '/';
      this.onDisk = names ? new Set(names.filter(isPng)) : null;
      this.disk = 'open';
      if (names && names.length > 0) {
        const found = names;
        setTimeout(() => this.cleanup(found), CLEANUP_DELAY_MS);
      }
      return true;
    } catch (e) {
      this.disk = 'broken';
      warn('pasta de imagens indisponível, o mapa fica sem imagens', e);
      return false;
    }
  }

  /**
   * Limpeza (uma vez por sessão, em segundo plano): apaga .tmp que sobraram de queda no meio da escrita e, se a
   * pasta passou de MAX_FILES ou MAX_BYTES, os PNGs mais antigos (data de modificação) até ~75% do limite.
   * Nunca apaga o que já foi entregue nesta sessão.
   */
  private cleanup(names: string[]): void {
    const dir = this.dir;
    if (!dir) return;
    try {
      const tmps = names.filter((n) => n.endsWith('.tmp'));
      const pngs = names.filter(isPng);
      let over = pngs.length > MAX_FILES;
      if (!over) {
        // uma chamada nativa que soma a pasta inteira; roda uma vez só
        const size = dir.size;
        over = typeof size === 'number' && size > MAX_BYTES;
      }
      if (!over) {
        if (tmps.length > 0) this.deleteSliced(dir, tmps);
        return;
      }
      const stats: FileStat[] = [];
      this.sliced(
        pngs,
        (name) => {
          try {
            const f = new File(dir, name);
            stats.push({ name, mtime: f.lastModified ?? 0, size: f.size || 0 });
          } catch {
            // sumiu no meio (o sistema limpou o cache): ignora
          }
        },
        () => {
          // sort estável: sem data (0) vão primeiro, na ordem da listagem
          stats.sort((a, b) => a.mtime - b.mtime);
          let files = stats.length;
          let bytes = 0;
          for (const s of stats) bytes += s.size;
          const victims = tmps.slice();
          for (const s of stats) {
            if (files <= MAX_FILES * TRIM_TO && bytes <= MAX_BYTES * TRIM_TO) break;
            if (this.live.has(s.name)) continue;
            victims.push(s.name);
            files--;
            bytes -= s.size;
          }
          this.deleteSliced(dir, victims);
        },
      );
    } catch (e) {
      warn('limpeza', e);
    }
  }

  private deleteSliced(dir: Directory, names: string[]): void {
    let removed = 0;
    this.sliced(
      names,
      (name) => {
        if (this.live.has(name)) return; // entregue depois da seleção: fica
        try {
          new File(dir, name).delete();
          removed++;
        } catch {
          // já não existia
        }
        if (this.onDisk) this.onDisk.delete(name);
      },
      () => {
        if (__DEV__ && removed > 0) {
          // eslint-disable-next-line no-console
          console.info('[mapimg] limpeza apagou ' + removed + ' arquivo(s)');
        }
      },
    );
  }

  /** percorre a lista em fatias de meio orçamento, cedendo com setTimeout(0) (a limpeza não disputa com render) */
  private sliced<T>(items: T[], fn: (item: T) => void, done: () => void): void {
    let i = 0;
    const step = (): void => {
      const deadline = now() + Math.max(2, this.budgetMs / 2);
      try {
        while (i < items.length) {
          fn(items[i++]);
          if (now() >= deadline) break;
        }
      } catch (e) {
        warn('limpeza', e);
      }
      if (i < items.length) {
        setTimeout(step, 0);
        return;
      }
      try {
        done();
      } catch (e) {
        warn('limpeza', e);
      }
    };
    setTimeout(step, 0);
  }
}

/** escreve num .tmp e renomeia: se o app cair no meio, não sobra PNG truncado com nome válido */
function writeAtomic(dir: Directory, name: string, bytes: Uint8Array): void {
  const tmp = new File(dir, name + '.tmp');
  tmp.write(bytes);
  try {
    tmp.rename(name);
  } catch (e) {
    // o destino já existe (sobrou de uma escrita anterior): fica o que está lá
    try {
      tmp.delete();
    } catch {
      // nada a fazer
    }
    if (!new File(dir, name).exists) throw e;
  }
}

/** instância única usada pelo motor do mapa */
export const mapImages = new ImageStore();
