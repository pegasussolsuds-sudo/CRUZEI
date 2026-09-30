import { nearbyFailCopy, nearbyNetState, nearbyStaleA11y, nearbyStaleText, updatedAgo } from './nearbyStatus';

const NOW = Date.UTC(2026, 8, 29, 22, 0, 0);
const MIN = 60_000;

describe('nearbyNetState: o que a sheet mostra quando o /location/nearby falha', () => {
  it('busca ok → ok (com ou sem lista)', () => {
    expect(nearbyNetState(false, NOW)).toBe('ok');
    expect(nearbyNetState(false, 0)).toBe('ok');
  });
  it('falhou sem lista → offline (nada de "0 pessoas")', () => {
    expect(nearbyNetState(true, 0)).toBe('offline');
    expect(nearbyNetState(true, Number.NaN)).toBe('offline');
  });
  it('falhou com a lista anterior → stale', () => {
    expect(nearbyNetState(true, NOW - 5 * MIN)).toBe('stale');
  });
});

describe('updatedAgo: idade da lista', () => {
  const cases: [number, string][] = [
    [0, 'atualizado há instantes'],
    [59_000, 'atualizado há instantes'],
    [MIN, 'atualizado há 1 min'],
    [45 * MIN + 30_000, 'atualizado há 45 min'],
    [60 * MIN, 'atualizado há 1 h'],
    [23 * 60 * MIN, 'atualizado há 23 h'],
    [24 * 60 * MIN, 'atualizado há 1 dia'],
    [3 * 24 * 60 * MIN, 'atualizado há 3 dias'],
  ];
  it.each(cases)('%p ms → %p', (age, text) => {
    expect(updatedAgo(NOW - age, NOW)).toBe(text);
  });
  it('relógio andando pra trás não dá idade negativa', () => {
    expect(updatedAgo(NOW + 10 * MIN, NOW)).toBe('atualizado há instantes');
  });
});

describe('nearbyStaleText: rótulo discreto da sheet', () => {
  it('junta o aviso de conexão com a idade', () => {
    expect(nearbyStaleText(NOW - 3 * MIN, NOW)).toBe('sem conexão · atualizado há 3 min');
  });
  it('servidor respondeu com erro (ocupado): não fala de conexão', () => {
    expect(nearbyStaleText(NOW - 3 * MIN, NOW, 'server')).toBe('servidor ocupado · atualizado há 3 min');
  });
  it('leitor de tela com concordância', () => {
    expect(nearbyStaleA11y(NOW - 3 * MIN, NOW)).toBe('Sem conexão com o servidor. Lista atualizada há 3 min');
    expect(nearbyStaleA11y(NOW - 3 * MIN, NOW, 'server')).toBe('Servidor ocupado. Lista atualizada há 3 min');
  });
});

describe('nearbyFailCopy: aviso sem lista', () => {
  it('rede fala de internet; servidor ocupado não', () => {
    expect(nearbyFailCopy('network')).toMatchObject({ title: 'Sem conexão com o servidor' });
    expect(nearbyFailCopy('network').hint).toMatch(/internet/);
    expect(nearbyFailCopy('server')).toMatchObject({ title: 'Servidor ocupado agora' });
    expect(nearbyFailCopy('server').hint).not.toMatch(/internet/);
  });
});
