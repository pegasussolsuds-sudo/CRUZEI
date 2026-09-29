import type { PlaceKind } from '@cruzei/shared-types';
import {
  CHIP_KINDS,
  browseDistance,
  intentOf,
  isBlocked,
  keepForText,
  nameScore,
  rankByDistance,
  rankPlaces,
  spellingVariant,
  spellingVariants,
  toHit,
  trustOf,
  type CatalogRow,
  type Hit,
} from './places.ranking';

const CENTER = { lat: -18.9186, lng: -48.2772 }; // centro de Uberlândia

/** chip do taxonomy.ts (scripts/geo) pro tipo */
const CHIP_OF: Partial<Record<PlaceKind, string>> = {
  nightclub: 'bar', pub: 'bar', bar: 'bar', cocktail: 'bar', brewery: 'bar', lounge: 'bar', nightlife: 'bar',
  music: 'show', theatre: 'show', events: 'show', cinema: 'show', entertainment: 'show',
  cafe: 'cafe', fastfood: 'restaurant', restaurant: 'restaurant', park: 'park', mall: 'shopping', museum: 'museum', gallery: 'museum',
};

function row(name: string, kind: PlaceKind, extra: Partial<CatalogRow> = {}): CatalogRow {
  return {
    id: `ovt:${name}`,
    name,
    kind,
    chip: CHIP_OF[kind] ?? null,
    confidence: 0.8,
    osm_confirmed: false,
    lat: CENTER.lat + 0.01,
    lng: CENTER.lng,
    address: 'Av. Rondon Pacheco, 100',
    neighborhood: 'Tibery',
    city: 'Uberlândia',
    state: 'MG',
    alt_names: [],
    ...extra,
  };
}

function hit(name: string, kind: PlaceKind, extra: Partial<CatalogRow> = {}): Hit {
  const h = toHit(row(name, kind, extra), CENTER);
  if (!h) throw new Error('linha inválida no teste');
  return h;
}

describe('places.ranking', () => {
  describe('toHit (linha do catálogo → lugar)', () => {
    it('monta id, chip, endereço, distância e a fonte', () => {
      const { place } = hit('Zenaide Bar', 'bar');
      expect(place.id).toBe('ovt:Zenaide Bar');
      expect(place.category).toBe('bar');
      expect(place.nightlife).toBe(true);
      expect(place.address).toBe('Av. Rondon Pacheco, 100, Tibery, Uberlândia');
      expect(place.state).toBe('MG');
      expect(place.distanceM).toBeGreaterThan(1000);
      expect(place.distanceM).toBeLessThan(1200);
      expect(place.source).toBe('catalog');
    });
    it('chip desconhecido vira null; lugar "outro" não é noite', () => {
      const { place } = hit('Drogasil', 'other', { chip: 'constructor' });
      expect(place.category).toBeNull();
      expect(place.nightlife).toBe(false);
    });
    it('descarta nome barrado, vazio ou sem coordenada', () => {
      expect(toHit(row('Garotas Acompanhantes VIP', 'nightclub'), CENTER)).toBeNull();
      expect(toHit(row('  ', 'bar'), CENTER)).toBeNull();
      expect(toHit(row('Bar X', 'bar', { lat: Number.NaN }), CENTER)).toBeNull();
    });
    it('sem centro a distância é 0; nomes alternativos iguais ao nome saem', () => {
      const h = toHit(row("Rubinho's Bar", 'pub', { alt_names: ['Bar do Rubinho', "Rubinho's Bar"] }), null);
      expect(h?.place.distanceM).toBe(0);
      expect(h?.altNames).toEqual(['Bar do Rubinho']);
    });
  });

  describe('trustOf', () => {
    it('sem sinal = 0,5; confirmado pelo OSM = pelo menos 0,7', () => {
      expect(trustOf(null, false)).toBe(0.5);
      expect(trustOf(0.1, true)).toBe(0.7); // "Nash Pub": 0,10 no Overture, balada no OSM
      expect(trustOf(0.95, true)).toBe(0.95);
      expect(trustOf(3, false)).toBe(1);
    });
  });

  describe('CHIP_KINDS', () => {
    it('cada chip do app lista tipos do catálogo; "Bares" pega balada e "Shows" pega casa de show', () => {
      expect(Object.keys(CHIP_KINDS).sort()).toEqual(['bar', 'beach', 'cafe', 'museum', 'park', 'restaurant', 'shopping', 'show']);
      expect(CHIP_KINDS.bar).toEqual(expect.arrayContaining(['nightclub', 'pub', 'bar', 'cocktail']));
      expect(CHIP_KINDS.show).toEqual(expect.arrayContaining(['music', 'theatre']));
      expect(CHIP_KINDS.restaurant).not.toContain('other');
    });
  });

  describe('intentOf', () => {
    it('palavra de rolê vira navegação pelos tipos', () => {
      expect(intentOf('Balada')?.browse).toEqual(['nightclub']);
      expect(intentOf('bares')?.browse).toEqual(['bar', 'pub', 'brewery', 'cocktail']);
      expect(intentOf('café')?.browse).toEqual(['cafe']);
    });
    it('shopping só aceita shopping', () => {
      expect(intentOf('Shopping')).toEqual({ browse: ['mall'], kinds: ['mall'] });
    });
    it('nome de lugar não é intenção', () => {
      expect(intentOf('zenaide')).toBeNull();
      expect(intentOf('bar do zé')).toBeNull();
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

  describe('spellingVariants', () => {
    it('simplifica letra dobrada palavra por palavra', () => {
      expect(spellingVariants('olli pizza')).toEqual(['olli pizz', 'oli pizza', 'olli piza']);
      expect(spellingVariants('zenaidde')).toEqual(['zenaidd', 'zenaide']);
    });
    it('respeita o teto e ignora palavra curta', () => {
      expect(spellingVariants('hub')).toEqual([]);
      expect(spellingVariants('olli pizza grill', 2)).toHaveLength(2);
    });
    it('"olli pizza": o Oli Pizza Bar vem primeiro', () => {
      const list = [hit('Pizzaria Riviera', 'fastfood'), hit('Oli Pizza Bar', 'restaurant')];
      const out = rankPlaces([list], 'olli pizza', spellingVariants('olli pizza'), 8);
      expect(out[0].name).toBe('Oli Pizza Bar');
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

  describe('keepForText', () => {
    it('lugar "outro" só com as palavras digitadas inteiras no nome', () => {
      expect(keepForText(hit('Live Odontologia', 'other'), 'liv')).toBe(false);
      expect(keepForText(hit('Drogasil', 'other'), 'drogasil')).toBe(true);
      expect(keepForText(hit('Liv Pub', 'bar'), 'live')).toBe(true);
    });
  });

  describe('rankPlaces', () => {
    it('"live": o Liv Pub fica acima do salão de festas e da clínica', () => {
      const list = [hit('Salão de Festas e Eventos - 3401 Live Events', 'events'), hit('Live Odontologia', 'other', { confidence: 0.95 }), hit('Liv Pub', 'bar', { confidence: 0.76 })];
      const out = rankPlaces([list], 'live', 'liv', 8);
      expect(out[0].name).toBe('Liv Pub');
      expect(out[0].nightlife).toBe(true);
    });
    it('"texas": o bar vem antes da loja de bebida e da lanchonete longe', () => {
      const list = [
        hit('Texas Lanches', 'restaurant', { lat: CENTER.lat + 0.27 }),
        hit('Texas Beer', 'other'),
        hit('Texas 54 Bar', 'cocktail'),
      ];
      expect(rankPlaces([list], 'texas', 'texa', 8)[0].name).toBe('Texas 54 Bar');
    });
    it('confiança desempata: página abandonada perde pro lugar confirmado', () => {
      const ghost = hit('Casa Madalena', 'pub', { id: 'ovt:a', confidence: 0.1 });
      const confirmed = hit('Casa Madalena', 'pub', { id: 'ovt:b', confidence: 0.1, osm_confirmed: true });
      expect(rankPlaces([[ghost, confirmed]], 'casa madalena', null, 8)[0].id).toBe('ovt:b');
    });
    it('nome alternativo do mesmo lugar conta ("bar do rubinho" acha o Rubinho\'s Bar)', () => {
      const out = rankPlaces([[hit('Bar do Zé', 'bar'), hit("Rubinho's Bar", 'pub', { alt_names: ['Bar do Rubinho'] })]], 'bar do rubinho', null, 8);
      expect(out[0].name).toBe("Rubinho's Bar");
    });
    it('não repete o mesmo lugar vindo de duas listas', () => {
      const a = hit('HUB', 'nightclub');
      expect(rankPlaces([[a], [a]], 'hub', null, 8)).toHaveLength(1);
    });
    it('respeita o limite', () => {
      const list = Array.from({ length: 12 }, (_, i) => hit(`Bar ${i}`, 'bar', { lat: CENTER.lat + i * 0.001 }));
      expect(rankPlaces([list], 'bar', null, 5)).toHaveLength(5);
    });
  });

  describe('rankByDistance', () => {
    it('mais perto primeiro', () => {
      const far = hit('Longe', 'restaurant', { lat: CENTER.lat + 0.05 });
      const near = hit('Perto', 'restaurant', { lat: CENTER.lat + 0.001 });
      expect(rankByDistance([[far, near]], 5).map((p) => p.name)).toEqual(['Perto', 'Longe']);
    });
    it('confiança muito baixa empurra pra trás (até 800 m)', () => {
      const ghost = hit('Balada Fantasma', 'nightclub', { lat: CENTER.lat + 0.001, confidence: 0.05 });
      const real = hit('Heaven Disco', 'nightclub', { lat: CENTER.lat + 0.005, confidence: 0.9 });
      expect(browseDistance(ghost)).toBeGreaterThan(browseDistance(real));
      expect(rankByDistance([[ghost, real]], 5)[0].name).toBe('Heaven Disco');
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
  });
});
