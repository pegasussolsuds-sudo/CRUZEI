import type { MapboxPlace } from '@cruzei/shared-types';
import { intentCategories, isBlocked, kindOf, nameScore, rankByDistance, rankPlaces, spellingVariant, toPlace, type SearchBoxFeature } from './places.ranking';

const CENTER = { lat: -18.9186, lng: -48.2772 }; // centro de Uberlândia

function feature(name: string, cats: string[], lat: number, lng: number, id = name): SearchBoxFeature {
  return {
    geometry: { coordinates: [lng, lat] },
    properties: {
      name,
      mapbox_id: id,
      feature_type: 'poi',
      address: 'Av. Rondon Pacheco',
      poi_category_ids: cats,
      coordinates: { latitude: lat, longitude: lng },
      context: { place: { name: 'Uberlândia' }, region: { name: 'Minas Gerais', region_code: 'MG' } },
    },
  };
}

function place(name: string, cats: string[], lat = CENTER.lat + 0.01, lng = CENTER.lng): MapboxPlace {
  const p = toPlace(feature(name, cats, lat, lng), CENTER);
  if (!p) throw new Error('feature inválida no teste');
  return p;
}

describe('places.ranking', () => {
  describe('kindOf', () => {
    it('balada vence bar quando as duas categorias vêm', () => {
      expect(kindOf(['entertainment', 'nightclub', 'nightlife'], 'HUB')).toEqual({ kind: 'nightclub', category: 'bar' });
    });
    it('bar com drinks continua bar', () => {
      expect(kindOf(['bar', 'cocktail_bar', 'food_and_drink'], 'Texas 54 Bar').kind).toBe('bar');
    });
    it('restaurante não vira "comes e bebes" genérico', () => {
      expect(kindOf(['food', 'food_and_drink', 'restaurant'], 'Tucci - Cucina & Café Bar')).toEqual({ kind: 'restaurant', category: 'restaurant' });
    });
    it('espaço de eventos com "Pub" no nome vira pub (caso do Liv Pub)', () => {
      expect(kindOf(['event_space', 'services'], 'Liv Pub')).toEqual({ kind: 'pub', category: 'bar' });
    });
    it('sem categoria conhecida fica "other"', () => {
      expect(kindOf(['dentist'], 'Live Odontologia')).toEqual({ kind: 'other', category: null });
    });
  });

  describe('spellingVariant', () => {
    it('tira a última letra da última palavra', () => {
      expect(spellingVariant('live')).toBe('liv');
      expect(spellingVariant('Bar do Texass')).toBe('bar do texas');
    });
    it('não mexe em palavra curta nem em número', () => {
      expect(spellingVariant('hub')).toBeNull();
      expect(spellingVariant('rua 2421')).toBeNull();
      expect(spellingVariant('')).toBeNull();
    });
  });

  describe('nameScore', () => {
    it('nome igual > começa com > palavra inteira > pedaço', () => {
      const exact = nameScore('HUB', 'hub', null);
      const prefix = nameScore('Zenaide Bar', 'zenaide', null);
      const word = nameScore('Espetaria Copacabana', 'copacabana', null);
      const part = nameScore('Supertexas', 'texas', null);
      expect(exact).toBeGreaterThan(prefix);
      expect(prefix).toBeGreaterThan(word);
      expect(word).toBeGreaterThan(part);
    });
    it('ignora acento e caixa', () => {
      expect(nameScore('Parque do Sabiá', 'SABIA', null)).toBeGreaterThanOrEqual(75);
    });
    it('a grafia alternativa conta como palavra', () => {
      expect(nameScore('Liv Pub', 'live', 'liv')).toBeGreaterThan(nameScore('Livraria Plural', 'live', 'liv'));
    });
  });

  describe('rankPlaces', () => {
    it('"live": o Liv Pub fica acima do salão de festas', () => {
      const primary = [place('Salão de Festas e Eventos - 3401 Live Events', ['event_space', 'services'])];
      const variant = [place('Liv Pub', ['event_space', 'services']), place('Liv Up - Uberlândia', ['food', 'food_and_drink'])];
      const out = rankPlaces([primary, variant], 'live', 'liv', 8);
      expect(out[0].name).toBe('Liv Pub');
      expect(out[0].nightlife).toBe(true);
    });
    it('"texas": o bar vem antes do atacadista e da hamburgueria longe', () => {
      const list = [
        place('Texas Hamburgueria', ['burger_restaurant', 'fast_food', 'food'], CENTER.lat + 0.27, CENTER.lng),
        place('Texas', ['food_wholesaler', 'shopping', 'wholesale_store']),
        place('Texas 54 Bar', ['bar', 'cocktail_bar', 'food_and_drink']),
      ];
      expect(rankPlaces([list], 'texas', 'texa', 8)[0].name).toBe('Texas 54 Bar');
    });
    it('não repete o mesmo lugar vindo de duas buscas', () => {
      const a = place('HUB', ['nightclub']);
      expect(rankPlaces([[a], [a]], 'hub', null, 8)).toHaveLength(1);
    });
    it('respeita o limite', () => {
      const list = Array.from({ length: 12 }, (_, i) => place(`Bar ${i}`, ['bar'], CENTER.lat + i * 0.001, CENTER.lng));
      expect(rankPlaces([list], 'bar', null, 5)).toHaveLength(5);
    });
  });

  describe('rankByDistance', () => {
    it('mais perto primeiro', () => {
      const far = place('Longe', ['restaurant'], CENTER.lat + 0.05, CENTER.lng);
      const near = place('Perto', ['restaurant'], CENTER.lat + 0.001, CENTER.lng);
      expect(rankByDistance([[far, near]], 5).map((p) => p.name)).toEqual(['Perto', 'Longe']);
    });
  });

  describe('intentCategories', () => {
    it('palavra de rolê vira categoria', () => {
      expect(intentCategories('Balada')).toEqual(['nightclub', 'music_venue']);
      expect(intentCategories('bares')).toEqual(['bar', 'pub', 'brewery']);
      expect(intentCategories('café')).toEqual(['cafe', 'coffee_shop']);
    });
    it('nome de lugar não é intenção', () => {
      expect(intentCategories('zenaide')).toBeNull();
      expect(intentCategories('bar do zé')).toBeNull();
    });
  });

  describe('isBlocked', () => {
    it('barra anúncio de acompanhante, massagem e motel', () => {
      expect(isBlocked('7 - Drinks Casa Rosa Club Boate Bar Pub Buteco Balada Garotas Acompanhantes Massagem Job Uberlândia')).toBe(true);
      expect(isBlocked('Motel Paradise')).toBe(true);
      expect(isBlocked('Swing Uberlândia')).toBe(true);
    });
    it('não barra lugar comum', () => {
      expect(isBlocked('London Pub')).toBe(false);
      expect(isBlocked('Programa Coração Sertanejo')).toBe(false);
    });
    it('toPlace descarta lugar barrado', () => {
      expect(toPlace(feature('Garotas Acompanhantes VIP', ['nightclub'], CENTER.lat, CENTER.lng), CENTER)).toBeNull();
    });
  });

  describe('toPlace', () => {
    it('monta id, endereço e distância', () => {
      const p = place('Zenaide Bar', ['bar', 'food_and_drink', 'nightlife']);
      expect(p.id).toBe('mbx:Zenaide Bar');
      expect(p.address).toBe('Av. Rondon Pacheco, Uberlândia');
      expect(p.city).toBe('Uberlândia');
      expect(p.state).toBe('MG');
      expect(p.distanceM).toBeGreaterThan(1000);
      expect(p.distanceM).toBeLessThan(1200);
      expect(p.source).toBe('mapbox');
    });
    it('descarta feature sem coordenada ou sem nome', () => {
      expect(toPlace({ properties: { name: 'X', mapbox_id: 'x' } }, CENTER)).toBeNull();
      expect(toPlace(feature('', ['bar'], 1, 1), CENTER)).toBeNull();
    });
  });
});
