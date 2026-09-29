import { expandAbbrev, labelFromAreas, labelFromPhoton, parsePhoton, rankGeoNames, toGeoResult, type GeoNameRow } from './geo.ranking';

const CENTER = { lat: -18.9186, lng: -48.2772 }; // centro de Uberlândia

function name(n: string, kind: string, extra: Partial<GeoNameRow> = {}): GeoNameRow {
  return {
    id: `osm:${n}`,
    kind,
    name: n,
    neighborhood: null,
    city: 'Uberlândia',
    state: 'MG',
    lat: CENTER.lat,
    lng: CENTER.lng,
    bbox: [],
    size_m: null,
    sim: 1,
    ...extra,
  };
}

describe('geo.ranking', () => {
  describe('labelFromAreas (Cidade · Bairro)', () => {
    it('bairro vence setor; cidade é o município', () => {
      const rows = [
        { kind: 'neighborhood', name: 'Centro', city: 'Uberlândia', state: 'MG' },
        { kind: 'district', name: 'Setor Central', city: 'Uberlândia', state: 'MG' },
        { kind: 'city', name: 'Uberlândia', city: 'Uberlândia', state: 'MG' },
      ];
      expect(labelFromAreas(rows)).toEqual({ city: 'Uberlândia', neighborhood: 'Centro', state: 'MG' });
    });
    it('fora dos bairros fica o distrito (Miraporanga)', () => {
      const rows = [
        { kind: 'district', name: 'Miraporanga', city: 'Uberlândia', state: 'MG' },
        { kind: 'city', name: 'Uberlândia', city: 'Uberlândia', state: 'MG' },
      ];
      expect(labelFromAreas(rows).neighborhood).toBe('Miraporanga');
    });
    it('ponto fora das áreas importadas: tudo null', () => {
      expect(labelFromAreas([])).toEqual({ city: null, neighborhood: null, state: null });
    });
  });

  describe('expandAbbrev', () => {
    it('abreviação de logradouro e título por extenso, sem acento', () => {
      expect(expandAbbrev('Av. João Naves de Ávila')).toBe('avenida joao naves de avila');
      expect(expandAbbrev('R 10')).toBe('rua 10');
      expect(expandAbbrev('Pça Tubal Vilela')).toBe('praca tubal vilela');
      expect(expandAbbrev('av gov rondon pacheco')).toBe('avenida governador rondon pacheco');
    });
    it('"r" no meio não vira rua; palavra comum fica', () => {
      expect(expandAbbrev('bloco r')).toBe('bloco r');
      expect(expandAbbrev('Santa Mônica')).toBe('santa monica');
    });
  });

  describe('toGeoResult', () => {
    it('rua leva bairro no contexto; distrito vira locality; bbox inválida vira null', () => {
      const street = toGeoResult(name('Rua Olegário Maciel', 'street', { neighborhood: 'Centro', bbox: [-48.28, -18.92, -48.27, -18.91] }));
      expect(street).toMatchObject({ type: 'street', context: 'Centro, Uberlândia - MG', bbox: [-48.28, -18.92, -48.27, -18.91] });
      expect(toGeoResult(name('Miraporanga', 'place'))).toMatchObject({ type: 'locality', context: 'Uberlândia - MG', bbox: null });
      expect(toGeoResult(name('Uberlândia', 'city'))?.context).toBe('MG');
      expect(toGeoResult(name('X', 'building'))).toBeNull();
    });
  });

  describe('rankGeoNames', () => {
    it('"Av. Rondon Pacheco": a avenida longa vem antes do trecho curto com o nome exato', () => {
      const rows = [
        name('Avenida Rondon Pacheco', 'street', { size_m: 233, neighborhood: 'Brasil' }),
        // o trigrama dá 0,83 (palavra a mais no meio); com todas as palavras no nome o texto vale cheio
        name('Avenida Governador Rondon Pacheco', 'street', { size_m: 14_321, neighborhood: 'Cazeca', sim: 0.83 }),
        name('Acesso Avenida Rondon Pacheco', 'street', { size_m: 31, sim: 0.83 }),
      ];
      const out = rankGeoNames(rows, 'Av. Rondon Pacheco', CENTER, 6);
      expect(out.map((r) => r.name)).toEqual(['Avenida Governador Rondon Pacheco', 'Avenida Rondon Pacheco', 'Acesso Avenida Rondon Pacheco']);
    });
    it('bairro vence rua de mesmo nome; o de longe perde', () => {
      const rows = [
        name('Rua Santa Mônica', 'street', { size_m: 900 }),
        name('Santa Mônica', 'neighborhood'),
        name('Santa Mônica', 'neighborhood', { id: 'osm:longe', city: 'Outra', lat: CENTER.lat + 1 }),
      ];
      const out = rankGeoNames(rows, 'santa monica', CENTER, 6);
      expect(out[0]).toMatchObject({ type: 'neighborhood', context: 'Uberlândia - MG' });
      expect(out[1].name).toBe('Rua Santa Mônica');
      expect(out[2].id).toBe('osm:longe');
    });
    it('distrito com o nome exato vence a rua de mesmo nome, mesmo longe do centro', () => {
      const rows = [name('Rua Miraporanga', 'street', { size_m: 1_000 }), name('Miraporanga', 'place', { lat: CENTER.lat - 0.3 })];
      expect(rankGeoNames(rows, 'miraporanga', CENTER, 6)[0]).toMatchObject({ type: 'locality', name: 'Miraporanga' });
    });
    it('respeita o limite', () => {
      const rows = Array.from({ length: 10 }, (_, i) => name(`Rua ${i}`, 'street', { id: `osm:st${i}` }));
      expect(rankGeoNames(rows, 'rua', CENTER, 4)).toHaveLength(4);
    });
  });

  describe('parsePhoton', () => {
    it('rua, endereço, bairro e cidade do Brasil; país/estado e fora do Brasil ficam de fora', () => {
      const out = parsePhoton([
        { geometry: { coordinates: [-48.27, -18.91] }, properties: { osm_type: 'W', osm_id: 1, type: 'street', name: 'Rua Tiradentes', district: 'Fundinho', city: 'Uberlândia', state: 'Minas Gerais', countrycode: 'BR', extent: [-48.28, -18.9, -48.26, -18.92] } },
        { geometry: { coordinates: [-48.27, -18.91] }, properties: { osm_type: 'N', osm_id: 2, type: 'house', street: 'Rua Tiradentes', housenumber: '100', city: 'Uberlândia', countrycode: 'BR' } },
        { geometry: { coordinates: [-48.26, -18.92] }, properties: { osm_type: 'R', osm_id: 3, type: 'district', name: 'Tibery', city: 'Uberlândia', state: 'Minas Gerais', countrycode: 'BR' } },
        { geometry: { coordinates: [-48.27, -18.91] }, properties: { osm_type: 'R', osm_id: 4, type: 'city', name: 'Uberlândia', state: 'Minas Gerais', countrycode: 'BR' } },
        { geometry: { coordinates: [-47, -15] }, properties: { osm_type: 'R', osm_id: 5, type: 'state', name: 'Minas Gerais', countrycode: 'BR' } },
        { geometry: { coordinates: [-58, -34] }, properties: { osm_type: 'W', osm_id: 6, type: 'street', name: 'Calle Uberlândia', countrycode: 'AR' } },
      ]);
      expect(out.map((r) => [r.type, r.name, r.context])).toEqual([
        ['street', 'Rua Tiradentes', 'Fundinho, Uberlândia, Minas Gerais'],
        ['address', 'Rua Tiradentes, 100', 'Uberlândia'],
        ['neighborhood', 'Tibery', 'Uberlândia, Minas Gerais'],
        ['city', 'Uberlândia', 'Minas Gerais'],
      ]);
      // extent do Photon em qualquer ordem vira [oeste, sul, leste, norte]
      expect(out[0].bbox).toEqual([-48.28, -18.92, -48.26, -18.9]);
      expect(out[0].id).toBe('osm:w1');
    });
  });

  describe('labelFromPhoton (fora das áreas importadas)', () => {
    it('bairro e cidade do ponto mais perto; nada útil = null', () => {
      expect(labelFromPhoton([{ properties: { type: 'house', district: 'Savassi', city: 'Belo Horizonte', countrycode: 'BR' } }])).toEqual({
        city: 'Belo Horizonte',
        neighborhood: 'Savassi',
        state: null,
      });
      expect(labelFromPhoton([{ properties: { type: 'city', name: 'Araguari', countrycode: 'BR' } }])).toEqual({ city: 'Araguari', neighborhood: null, state: null });
      expect(labelFromPhoton([{ properties: { type: 'state', name: 'Minas Gerais', countrycode: 'BR' } }])).toBeNull();
      expect(labelFromPhoton([])).toBeNull();
    });
  });
});
