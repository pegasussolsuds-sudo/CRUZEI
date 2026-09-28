import type { MapboxPlace } from '@cruzei/shared-types';
import { encodeGeohash } from '@cruzei/shared-utils';
import { addDays, evaluateCandidate, evaluateCell, pickVenues, type CellStats } from './crowd-rules';

const cfg = { MIN_DAILY: 3, MIN_ACTIVE_DAYS: 2, MIN_UNION: 8, MAX_REPEAT: 1.6, NIGHT_MAX_SHARE: 0.35, VENUE_RADIUS_M: 45, VENUE_MIN_SHARE: 0.3 };
const stats = (daily: number[], union: number, bands: [number, number, number] = [0, 10, 30], homes = 0): CellStats => ({ daily, union, bands, homes });

describe('evaluateCell (a célula parece um lugar?)', () => {
  it('bar: 6 na sexta, 7 no sábado, ninguém no domingo, 12 distintos → passa', () => {
    expect(evaluateCell(stats([0, 7, 6], 12), cfg)).toEqual({ ok: true });
  });
  it('dois grupos de 4 em noites diferentes (8 distintos, sem repetição) → passa', () => {
    expect(evaluateCell(stats([4, 4, 0], 8), cfg)).toEqual({ ok: true });
  });
  it('casa/república: poucos distintos e as mesmas pessoas todo dia → não passa', () => {
    expect(evaluateCell(stats([5, 5, 4], 5), cfg).ok).toBe(false);
  });
  it('escritório: 15 pessoas iguais em 3 dias (repetição 3,0) → não passa', () => {
    expect(evaluateCell(stats([15, 15, 15], 15), cfg)).toEqual({ ok: false, reason: 'repeat' });
  });
  it('grupo de amigos (6 em 2 noites) → não passa', () => {
    expect(evaluateCell(stats([6, 6, 0], 6), cfg)).toEqual({ ok: false, reason: 'few_people' });
  });
  it('festa única (um dia só) → não passa', () => {
    expect(evaluateCell(stats([30, 0, 0], 30), cfg)).toEqual({ ok: false, reason: 'few_days' });
  });
  it('permanência de madrugada (04–08 h) dominante = residência → não passa', () => {
    expect(evaluateCell(stats([5, 5, 0], 9, [20, 10, 10]), cfg)).toEqual({ ok: false, reason: 'night' });
  });
  it('célula dominada por residências aprendidas → não passa', () => {
    expect(evaluateCell(stats([5, 5, 0], 9, [0, 10, 10], 5), cfg)).toEqual({ ok: false, reason: 'residential' });
    // perto de casas, mas a multidão é muito maior que os moradores → passa (centro da cidade)
    expect(evaluateCell(stats([20, 25, 0], 40, [0, 10, 30], 4), cfg)).toEqual({ ok: true });
  });
});

describe('pickVenues (qual lugar leva a multidão)', () => {
  const place = (name: string, lat: number, lng: number, kind: MapboxPlace['kind'] = 'bar'): MapboxPlace => ({
    id: `mbx:${name}`, name, category: 'bar', kind, nightlife: true, address: null, neighborhood: null, city: 'Uberlândia', state: 'MG', latitude: lat, longitude: lng, distanceM: 0, source: 'mapbox',
  });
  const bar = { lat: -18.9186, lng: -48.2772 };
  const sub = (lat: number, lng: number, stays: number) => ({ sub: encodeGeohash(lat, lng, 8), stays });

  it('lugar dominante leva a célula', () => {
    const subs = [sub(bar.lat, bar.lng, 40), sub(bar.lat + 0.0012, bar.lng, 5)];
    const r = pickVenues([place('Bar do Léo', bar.lat, bar.lng), place('Longe Bar', bar.lat + 0.004, bar.lng)], subs, 45, cfg);
    expect(r.picks.map((p) => p.name)).toEqual(['Bar do Léo']);
    expect(r.ambiguous).toBe(false);
  });
  it('dois lugares vizinhos dividindo a multidão = ambíguo', () => {
    const subs = [sub(bar.lat, bar.lng, 20), sub(bar.lat, bar.lng + 0.0009, 20)];
    const r = pickVenues([place('Bar A', bar.lat, bar.lng), place('Bar B', bar.lat, bar.lng + 0.0009)], subs, 40, cfg);
    expect(r.picks).toHaveLength(2);
    expect(r.ambiguous).toBe(true);
  });
  it('tipo fora da lista automática, nome adulto ou buffet infantil nunca levam', () => {
    const subs = [sub(bar.lat, bar.lng, 40)];
    const venues = [place('Clínica Sorriso', bar.lat, bar.lng, 'other'), place('Motel Estrela', bar.lat, bar.lng), place('Buffet Infantil Alegria', bar.lat, bar.lng, 'restaurant')];
    expect(pickVenues(venues, subs, 40, cfg).picks).toEqual([]);
  });
});

describe('evaluateCandidate', () => {
  const today = '2026-09-28';
  const base = { name: 'Zenaide Bar', kind: 'bar' as const, ambiguous: false, crowdPassOn: null, lastEvidenceOn: today };
  const none = { onsite3: 0, req14: 0, deny3: 0 };
  it('regra A: multidão passou ontem e o lugar é dominante', () => {
    expect(evaluateCandidate({ ...base, crowdPassOn: addDays(today, -1) }, none, today)).toBe('promote_crowd');
    expect(evaluateCandidate({ ...base, crowdPassOn: addDays(today, -2) }, none, today)).toBe('keep');
    expect(evaluateCandidate({ ...base, crowdPassOn: today, ambiguous: true }, none, today)).toBe('keep');
  });
  it('regra B: 2 pessoas no lugar em 3 dias; regra C: 4 pedidos em 14 dias', () => {
    expect(evaluateCandidate(base, { ...none, onsite3: 2 }, today)).toBe('promote_onsite');
    expect(evaluateCandidate(base, { ...none, req14: 3 }, today)).toBe('keep');
    expect(evaluateCandidate(base, { ...none, req14: 4 }, today)).toBe('promote_requests');
  });
  it('2 negações no lugar derrubam, mesmo com pedidos', () => {
    expect(evaluateCandidate(base, { onsite3: 2, req14: 9, deny3: 2 }, today)).toBe('reject');
  });
  it('nome/tipo reprovado ao reavaliar e candidato sem evidência há 15 dias', () => {
    expect(evaluateCandidate({ ...base, kind: 'other' }, { ...none, req14: 9 }, today)).toBe('reject');
    expect(evaluateCandidate({ ...base, lastEvidenceOn: addDays(today, -15) }, none, today)).toBe('expire');
  });
  it('addDays atravessa mês e ano', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });
});
