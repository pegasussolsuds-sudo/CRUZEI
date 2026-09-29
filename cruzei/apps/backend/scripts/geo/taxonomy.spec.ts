import { classifyOsm, classifyOverture, type OvertureRow } from './taxonomy';

const ovt = (name: string, basic: string | null, category: string | null = basic, confidence = 0.8, hierarchy: string[] | null = null): OvertureRow => ({
  name,
  basic_category: basic,
  category,
  hierarchy,
  confidence,
});

describe('classifyOverture', () => {
  it('mapeia a noite pro tipo e chip do app', () => {
    expect(classifyOverture(ovt('Velvet Uberlândia', 'dance_club'))).toEqual({ kind: 'nightclub', chip: 'bar', searchable: true });
    expect(classifyOverture(ovt('London Pub', 'bar', 'pub'))).toMatchObject({ kind: 'pub', chip: 'bar' });
    expect(classifyOverture(ovt('Mariposa Gastrobar', 'casual_eatery', 'gastropub'))).toMatchObject({ kind: 'pub' });
    expect(classifyOverture(ovt('Salud! Coquetelaria', 'bar', 'cocktail_bar'))).toMatchObject({ kind: 'cocktail' });
    expect(classifyOverture(ovt('Mirage hookah lounge', 'bar', 'hookah_bar'))).toMatchObject({ kind: 'lounge' });
    expect(classifyOverture(ovt('Beira Rio Beer', 'alcoholic_beverage_venue', 'beer_garden'))).toMatchObject({ kind: 'brewery' });
    expect(classifyOverture(ovt('Yellow Hall', 'music_venue'))).toMatchObject({ kind: 'music', chip: 'show' });
  });

  it('comida, café, parque e shopping', () => {
    expect(classifyOverture(ovt('Pizzaria X', 'restaurant', 'pizza_restaurant'))).toMatchObject({ kind: 'restaurant', chip: 'restaurant' });
    expect(classifyOverture(ovt('Panificadora Maná', 'casual_eatery', 'bakery'))).toMatchObject({ kind: 'cafe', chip: 'cafe' });
    expect(classifyOverture(ovt('Praça Tubal Vilela', 'public_plaza'))).toMatchObject({ kind: 'park', chip: 'park' });
    expect(classifyOverture(ovt('Center Shopping', 'shopping_mall'))).toMatchObject({ kind: 'mall', chip: 'shopping' });
  });

  it('categoria genérica: o nome decide', () => {
    expect(classifyOverture(ovt('Bar do Jorginho', 'arts_and_entertainment'))).toMatchObject({ kind: 'bar' });
    expect(classifyOverture(ovt('Mamba Club', null, null))).toMatchObject({ kind: 'nightclub' });
    // "clube" é clube social, não balada
    expect(classifyOverture(ovt('Praia Clube', 'arts_and_entertainment'))).toMatchObject({ kind: 'entertainment' });
  });

  it('buffet, chácara e festa ficam fora da busca padrão', () => {
    expect(classifyOverture(ovt('Chácara TK Festas e Eventos', 'event_or_party_service', 'party_and_event_planning'))).toEqual({ kind: 'events', chip: 'show', searchable: false });
    expect(classifyOverture(ovt('Mansos Hall - Festas e Eventos', 'music_venue'))).toMatchObject({ kind: 'events', searchable: false });
    expect(classifyOverture(ovt('Chacara Sonho Meu', 'park'))).toMatchObject({ searchable: false });
  });

  it('descarta ruído, conteúdo adulto e residência', () => {
    expect(classifyOverture(ovt('Disk Bebidas Pequis', 'bar'))).toBeNull();
    expect(classifyOverture(ovt('Distribuidora Gela Guela', 'food_and_drink'))).toBeNull();
    expect(classifyOverture(ovt('Selva Motel', 'hotel'))).toBeNull();
    expect(classifyOverture(ovt('Ponto 7 Acompanhantes Massagem', 'arts_and_entertainment'))).toBeNull();
    expect(classifyOverture(ovt('Condomínio Edifício Riviera', 'historic_site'))).toBeNull();
    expect(classifyOverture(ovt('Fulano de Tal', 'professional_service', 'professional_service', 0.1))).toBeNull();
    // distribuidora que também é bar fica
    expect(classifyOverture(ovt('Padano - Bar e Distribuidora de Bebidas', 'bar'))).toMatchObject({ kind: 'bar' });
  });

  it('página de serviço classificada como casa de show vira other', () => {
    expect(classifyOverture(ovt('Studio Jack Carvalho', 'music_venue'))).toMatchObject({ kind: 'other', chip: null });
    expect(classifyOverture(ovt('Strike Boliche', 'dance_club'))).toMatchObject({ kind: 'entertainment' });
  });
});

describe('classifyOsm', () => {
  it('mapeia tags', () => {
    expect(classifyOsm({ amenity: 'nightclub', name: 'Nash Pub' })).toMatchObject({ kind: 'nightclub', chip: 'bar', rawCategory: 'amenity=nightclub' });
    expect(classifyOsm({ amenity: 'bar', name: 'Capilé', cocktails: 'yes' })).toMatchObject({ kind: 'cocktail' });
    expect(classifyOsm({ leisure: 'park', name: 'Parque do Sabiá' })).toMatchObject({ kind: 'park', chip: 'park' });
    expect(classifyOsm({ shop: 'mall', name: 'Center Shopping' })).toMatchObject({ kind: 'mall' });
  });

  it('descarta privado, fechado e adulto', () => {
    expect(classifyOsm({ leisure: 'garden', name: 'Jardim', access: 'private' })).toBeNull();
    expect(classifyOsm({ amenity: 'stripclub', name: 'X' })).toBeNull();
    expect(classifyOsm({ amenity: 'bar' })).toBeNull();
  });
});
