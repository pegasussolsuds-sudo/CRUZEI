// Lote por quadro e por rajada: o que é pedido no mesmo quadro roda numa tarefa só; rajada sai no máx. a cada 100 ms.
import { BURST_MAX, flushFrame, nextFrame, soon, SOON_MS } from './frameBatch';

let frames = 0;
beforeAll(() => {
  // quadro de 16 ms; conta quantas tarefas de quadro rodaram
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (cb: (t: number) => void) =>
    setTimeout(() => {
      frames += 1;
      cb(Date.now());
    }, 16) as unknown as number;
  (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = (id: number) => clearTimeout(id as never);
});
beforeEach(() => {
  jest.useFakeTimers({ now: 1_000_000 });
  frames = 0;
});
afterEach(() => {
  flushFrame();
  jest.useRealTimers();
});

it('10 pedidos no mesmo quadro = 1 tarefa, na ordem; o que eles agendam roda na mesma tarefa', () => {
  const order: number[] = [];
  for (let i = 0; i < 10; i++) nextFrame(() => order.push(i));
  nextFrame(() => nextFrame(() => order.push(99))); // ex.: o aviso às telas agendado por um evento
  expect(order).toEqual([]);
  jest.advanceTimersByTime(16);
  expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 99]);
  expect(frames).toBe(1);
});

it('chave repetida: só a última roda, depois das outras que chegaram antes dela', () => {
  const order: string[] = [];
  nextFrame(() => order.push('read m4'), 'read:c1');
  nextFrame(() => order.push('new m5'));
  nextFrame(() => order.push('read m5'), 'read:c1');
  jest.advanceTimersByTime(16);
  expect(order).toEqual(['new m5', 'read m5']);
});

it('um job que falha não derruba os outros do quadro', () => {
  const reportError = jest.fn();
  (globalThis as { ErrorUtils?: unknown }).ErrorUtils = { reportError };
  const ran = jest.fn();
  nextFrame(() => {
    throw new Error('payload estranho');
  });
  nextFrame(ran);
  jest.advanceTimersByTime(16);
  expect(ran).toHaveBeenCalledTimes(1);
  expect(reportError).toHaveBeenCalledTimes(1);
});

it('sem quadro (segundo plano): o relógio de reserva roda em 100 ms', () => {
  const raf = globalThis.requestAnimationFrame;
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 1; // nunca dispara
  const ran = jest.fn();
  nextFrame(ran);
  jest.advanceTimersByTime(99);
  expect(ran).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1);
  expect(ran).toHaveBeenCalledTimes(1);
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = raf;
});

it('rajada: 1º evento no próximo quadro; 45 eventos/s por 2 s saem em ≤ 1 lote a cada 100 ms', () => {
  const batches: number[] = [];
  let pending = 0;
  const fire = () => {
    pending += 1;
    soon(() => {
      if (pending) batches.push(pending);
      pending = 0;
    });
  };
  fire();
  jest.advanceTimersByTime(16);
  expect(batches).toEqual([1]); // sem espera depois de um silêncio
  frames = 0;
  for (let t = 0; t < 2_000; t += 22) {
    fire();
    jest.advanceTimersByTime(22);
  }
  jest.advanceTimersByTime(SOON_MS + 16);
  const events = batches.slice(1).reduce((a, b) => a + b, 0);
  expect(events).toBe(Math.ceil(2_000 / 22));
  expect(batches.length - 1).toBeLessThanOrEqual(2_000 / SOON_MS + 1);
  expect(frames).toBeLessThanOrEqual(2_000 / SOON_MS + 1);
});

it('relógio do aparelho voltando 1 h: a rajada sai no tempo normal (relógio monotônico; espera de no máx. SOON_MS)', () => {
  const ran: number[] = [];
  soon(() => ran.push(1));
  // (o relógio falso recomeça a cada teste: a 1ª rajada daqui espera no máx. SOON_MS pela última do teste anterior)
  jest.advanceTimersByTime(SOON_MS + 16);
  expect(ran).toEqual([1]);
  jest.setSystemTime(Date.now() - 3_600_000); // ajuste automático de hora
  soon(() => ran.push(2));
  jest.advanceTimersByTime(SOON_MS + 16);
  expect(ran).toEqual([1, 2]); // antes: esperava "último + 100 ms - agora" = 1 h, com todos os eventos do socket presos
});

it('fila que cresceu em segundo plano sai em fatias de BURST_MAX, na ordem, com o descarte por chave valendo entre fatias', () => {
  const order: number[] = [];
  const key = (i: number) => (i === 10 || i === 900 ? 'k' : i === 500 ? 'q' : undefined);
  for (let i = 0; i < 1000; i++) soon(() => order.push(i), key(i));
  const slices: number[] = [];
  let last = 0;
  let requeued = false;
  for (let t = 0; t < 2_000 && order.length < 999; t++) {
    jest.advanceTimersByTime(1);
    if (order.length === last) continue;
    slices.push(order.length - last);
    last = order.length;
    if (!requeued) {
      requeued = true;
      soon(() => order.push(2000), 'q'); // o 500 (ainda na fila, noutra fatia) perde a vez
    }
  }
  expect(Math.max(...slices)).toBeLessThanOrEqual(BURST_MAX);
  expect(slices.length).toBeGreaterThanOrEqual(5);
  const want = Array.from({ length: 1000 }, (_, i) => i).filter((i) => i !== 10 && i !== 500);
  expect(order).toEqual([...want, 2000]);
});
