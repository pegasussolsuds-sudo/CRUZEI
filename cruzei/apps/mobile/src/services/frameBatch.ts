// Um quadro, uma passada de render. No RN (bridgeless) cada tarefa da thread JS termina com o React desenhando o que
// mudou nela: 3 eventos do socket chegando no mesmo quadro (curtida + match + conversa promovida) ou 2 buscas do React
// Query terminando juntas eram 3 e 2 passadas de render. Aqui tudo o que é pedido dentro do quadro roda numa tarefa só,
// no próximo quadro (requestAnimationFrame). O relógio de reserva cobre o app sem quadros (segundo plano).

type Job = () => void;

const FALLBACK_MS = 100;
/** o que os jobs agendam enquanto rodam (ex.: o aviso às telas depois de um evento) roda na mesma tarefa, até 4 voltas */
const MAX_PASSES = 4;
/** rajada (`soon`): no máx. um lote a cada 100 ms — abaixo do que se percebe numa lista ou num contador */
export const SOON_MS = 100;
/** jobs por lote da rajada: a fila que cresceu em segundo plano (socket ligado, timers parados) sai em fatias, não numa tarefa só */
export const BURST_MAX = 200;

/**
 * Relógio monotônico (ms). O Date.now() volta atrás quando o aparelho acerta a hora, e uma espera "até o último + intervalo"
 * viraria o tamanho do salto (mapa e eventos parados). Lido a cada chamada: os timers falsos do jest trocam o `performance`.
 */
export function monoNow(): number {
  const p = (globalThis as { performance?: { now?: () => number } }).performance;
  return typeof p?.now === 'function' ? p.now() : Date.now();
}

const noop: Job = () => undefined;

/** fila com descarte por chave: o job anterior com a mesma chave perde a vez e o novo vai pro fim */
class KeyedQueue {
  jobs: Job[] = [];
  private keyed = new Map<string, number>();
  push(job: Job, key?: string): void {
    if (key !== undefined) {
      const at = this.keyed.get(key);
      if (at !== undefined) this.jobs[at] = noop;
      this.keyed.set(key, this.jobs.length);
    }
    this.jobs.push(job);
  }
  /** esvazia e devolve até `max` jobs (o que for agendado enquanto eles rodam entra atrás do que sobrou) */
  take(max = Infinity): Job[] {
    if (this.jobs.length > max) {
      const keyed = new Map<string, number>();
      for (const [k, at] of this.keyed) if (at >= max) keyed.set(k, at - max);
      this.keyed = keyed;
      return this.jobs.splice(0, max);
    }
    const jobs = this.jobs;
    this.jobs = [];
    this.keyed = new Map();
    return jobs;
  }
}

function report(e: unknown): void {
  // um job que falha não derruba os outros do lote; o erro segue pro handler global (Sentry), sem ser fatal
  const eu = (globalThis as { ErrorUtils?: { reportError?: (err: unknown) => void } }).ErrorUtils;
  if (eu?.reportError) eu.reportError(e);
  else
    setTimeout(() => {
      throw e;
    }, 0);
}

function runAll(jobs: Job[]): void {
  for (const job of jobs) {
    try {
      job();
    } catch (e) {
      report(e);
    }
  }
}

// ───────────── quadro ─────────────
const frame = new KeyedQueue();
let armed = false;
let rafId: number | null = null;
let timerId: ReturnType<typeof setTimeout> | null = null;

function arm(): void {
  armed = true;
  rafId = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(flushFrame) : null;
  timerId = setTimeout(flushFrame, rafId == null ? 16 : FALLBACK_MS);
}

/** roda agora o que está na fila (o quadro chegou). Exportada pros testes. */
export function flushFrame(): void {
  if (!armed) return;
  armed = false;
  if (rafId != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
  if (timerId) clearTimeout(timerId);
  rafId = null;
  timerId = null;
  for (let pass = 0; pass < MAX_PASSES && frame.jobs.length; pass++) runAll(frame.take());
  if (frame.jobs.length) arm();
}

/**
 * Agenda `job` pro próximo quadro. Com `key`, um job anterior com a mesma chave ainda na fila é descartado e o novo vai
 * pro fim (ex.: 5 'message:read' da mesma conversa no quadro = só o último, depois das mensagens que chegaram antes dele).
 */
export function nextFrame(job: Job, key?: string): void {
  frame.push(job, key);
  if (!armed) arm();
}

// ───────────── rajada ─────────────
const burst = new KeyedQueue();
let burstArmed = false;
let lastBurst = -Infinity;

function drainBurst(): void {
  burstArmed = false;
  lastBurst = monoNow();
  runAll(burst.take(BURST_MAX));
  if (burst.jobs.length && !burstArmed) armBurst();
}

function armBurst(): void {
  burstArmed = true;
  // (no máx. SOON_MS: um relógio que voltou não segura a fila)
  const wait = Math.min(SOON_MS, lastBurst + SOON_MS - monoNow());
  if (wait <= 0) nextFrame(drainBurst);
  else setTimeout(() => nextFrame(drainBurst), wait);
}

/**
 * Como `nextFrame`, mas pra rajadas (eventos do socket): o 1º evento depois de um silêncio vai no próximo quadro; os
 * que chegam em seguida esperam e saem juntos, no máx. um lote a cada SOON_MS. 45 eventos/s = ≤ 10 passadas/s.
 */
export function soon(job: Job, key?: string): void {
  burst.push(job, key);
  if (!burstArmed) armBurst();
}
