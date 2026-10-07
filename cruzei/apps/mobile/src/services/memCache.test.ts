import { MemCache, clearMemCaches, memCacheStats } from './memCache';

describe('MemCache (LRU com teto em bytes estimados)', () => {
  it('solta os mais antigos até caber em bytes; o lido por último fica', () => {
    const c = new MemCache<string>('t.bytes', 100);
    c.set('a', 'A', 40);
    c.set('b', 'B', 40);
    expect(c.get('a')).toBe('A'); // renova: b vira o mais antigo
    c.set('c', 'C', 40);
    expect(c.has('b')).toBe(false);
    expect(c.has('a') && c.has('c')).toBe(true);
    expect(c.bytes).toBe(80);
  });

  it('teto de itens, troca de valor da mesma chave e o recém-chegado maior que o teto', () => {
    const c = new MemCache<number | null>('t.items', 1000, 2);
    c.set('a', 1, 10);
    c.set('b', null, 10); // null é valor guardado (ex.: "sem aura"), undefined é "não tem"
    expect(c.get('b')).toBeNull();
    expect(c.get('x')).toBeUndefined();
    c.set('c', 3, 10);
    expect(c.size).toBe(2);
    expect(c.has('a')).toBe(false);
    c.set('c', 4, 30);
    expect(c.bytes).toBe(40);
    c.set('big', 5, 5000);
    expect(c.size).toBe(1);
    expect(c.get('big')).toBe(5);
    expect(c.bytes).toBe(5000);
  });

  it('o registro solta todos os caches de uma vez (memória baixa, app no fundo)', () => {
    const a = new MemCache<number>('t.reg.a', 100);
    const b = new MemCache<number>('t.reg.b', 100);
    a.set('x', 1, 10);
    b.set('y', 2, 20);
    expect(memCacheStats()['t.reg.b']).toEqual({ items: 1, bytes: 20 });
    clearMemCaches();
    expect(a.size + b.size).toBe(0);
    expect(memCacheStats()['t.reg.a']).toEqual({ items: 0, bytes: 0 });
  });
});
