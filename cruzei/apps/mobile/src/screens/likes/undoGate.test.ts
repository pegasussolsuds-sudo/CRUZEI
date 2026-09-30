import { createUndoGate } from './undoGate';

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('"Voltar" do deck: um por vez, e o passar novo só depois dele', () => {
  it('com o "Voltar" voando fica ocupado e não roda outro', async () => {
    const gate = createUndoGate();
    const del = deferred();
    const op2 = jest.fn(async () => undefined);
    expect(gate.busy).toBe(false);
    const req = gate.run(() => del.promise);
    expect(req).not.toBeNull();
    expect(gate.busy).toBe(true);
    expect(gate.run(op2)).toBeNull();
    expect(op2).not.toHaveBeenCalled();
    del.resolve();
    await req;
    await flush();
    expect(gate.busy).toBe(false);
    expect(gate.run(op2)).not.toBeNull();
    expect(op2).toHaveBeenCalledTimes(1);
  });

  it('ação que já tinha saído espera o DELETE acabar antes do POST (ordem no servidor)', async () => {
    const gate = createUndoGate();
    const order: string[] = [];
    const del = deferred();
    const req = gate.run(async () => {
      await del.promise;
      order.push('DELETE');
    });
    const post = gate.settled().then(() => order.push('POST'));
    await flush();
    expect(order).toEqual([]);
    del.resolve();
    await Promise.all([req, post]);
    expect(order).toEqual(['DELETE', 'POST']);
  });

  it('DELETE que falhou também libera (o erro fica com quem pediu)', async () => {
    const gate = createUndoGate();
    const del = deferred();
    const req = gate.run(() => del.promise);
    const waiting = gate.settled();
    del.reject(new Error('409'));
    await expect(req).rejects.toThrow('409');
    await expect(waiting).resolves.toBeUndefined();
    await flush();
    expect(gate.busy).toBe(false);
  });

  it('sem "Voltar" em andamento, não espera nada', async () => {
    const gate = createUndoGate();
    await expect(gate.settled()).resolves.toBeUndefined();
  });

  it('erro síncrono de quem monta a requisição vira rejeição (e não trava o deck)', async () => {
    const gate = createUndoGate();
    const req = gate.run(() => {
      throw new Error('boom');
    });
    await expect(req).rejects.toThrow('boom');
    await flush();
    expect(gate.busy).toBe(false);
  });
});
