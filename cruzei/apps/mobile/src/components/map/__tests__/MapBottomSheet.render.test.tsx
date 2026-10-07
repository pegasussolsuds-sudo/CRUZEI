// Lista do mapa sob multidão: um /nearby novo (a cada 45 s, com 300 pessoas) não pode refazer todas as linhas. O react-query
// preserva o objeto de quem não mudou; a linha (memo) só re-renderiza se a pessoa dela mudou — desde que as callbacks
// cheguem estáveis (o MapScreen segura onLike/onSuperLike/onOpenProfile por ref: antes elas mudavam a cada resposta, junto
// com o bandById, e toda linha montada re-renderizava; o último caso abaixo mostra o efeito).

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { NearbyUser, ProximityBand } from '@cruzei/shared-types';

let mockRowRenders: string[] = [];
jest.mock('../PersonRow', () => {
  const R = jest.requireActual('react');
  // mesma regra do PersonRow de verdade (memo com comparação rasa): conta quem renderizou
  const PersonRow = R.memo(function PersonRow(p: { user: { id: string } }) {
    mockRowRenders.push(p.user.id);
    return null;
  });
  return { PersonRow };
});
jest.mock('@gorhom/bottom-sheet', () => {
  const R = jest.requireActual('react');
  const { FlatList, View } = jest.requireActual('react-native');
  const BottomSheet = R.forwardRef((p: { children?: unknown }, _ref: unknown) => R.createElement(View, null, p.children));
  return { __esModule: true, default: BottomSheet, BottomSheetFlatList: FlatList, BottomSheetFooter: (p: { children?: unknown }) => p.children };
});
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: () => {} }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../animated/FadeInView', () => ({ FadeInView: (p: { children?: unknown }) => p.children }));
jest.mock('../../animated/LiveDot', () => ({ LiveDot: () => null }));
jest.mock('../../animated/ScaleOnPress', () => ({ ScaleOnPress: (p: { children?: unknown }) => p.children }));

// eslint-disable-next-line import/first
import { MapBottomSheet } from '../MapBottomSheet';

const BANDS: ProximityBand[] = ['very_near', 'near', 'region', 'boost'];
function person(i: number): NearbyUser {
  return { id: 'p' + i, name: 'Pessoa ' + i, isOnline: i % 2 === 0, proximityBand: BANDS[i % 4], isAnonymous: false } as unknown as NearbyUser;
}
const noop = () => {};
const props = (users: NearbyUser[]) => ({
  users,
  bandById: new Map(users.map((u) => [u.id, u.proximityBand] as const)),
  radiusM: 350,
  isFree: false,
  isLoading: false,
  containerHeight: 800,
  poiFilter: null,
  onClearPoiFilter: noop,
  onChange: noop,
  onSelect: noop,
  onLike: noop,
  onSuperLike: noop,
  onPass: noop,
});

// a VirtualizedList agenda lotes de render por timer: relógio de mentira e desmonta no fim (nada roda depois do teste)
const mounted: ReactTestRenderer[] = [];
beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  act(() => {
    for (const t of mounted.splice(0)) t.unmount();
  });
  jest.useRealTimers();
});

describe('MapBottomSheet sob multidão', () => {
  it('um /nearby novo com 300 pessoas re-renderiza só as linhas de quem mudou', () => {
    const users = Array.from({ length: 300 }, (_, i) => person(i));
    let tree: ReactTestRenderer;
    act(() => {
      tree = create(<MapBottomSheet {...props(users)} />);
      mounted.push(tree);
    });
    const rows = new Set(mockRowRenders).size;
    expect(rows).toBeGreaterThan(3);
    // resposta nova: Map de faixas novo, 3 pessoas mudaram (o react-query preserva o objeto das outras 297)
    const next = users.map((u, i) => (i < 3 ? { ...u, isOnline: !u.isOnline } : u));
    mockRowRenders = [];
    act(() => {
      tree.update(<MapBottomSheet {...props(next)} />);
    });
    expect(mockRowRenders.sort()).toEqual(['p0', 'p1', 'p2']);
  });

  it('só o Map de faixas novo (mesma lista): nenhuma linha re-renderiza', () => {
    const users = Array.from({ length: 300 }, (_, i) => person(i));
    let tree: ReactTestRenderer;
    act(() => {
      tree = create(<MapBottomSheet {...props(users)} />);
      mounted.push(tree);
    });
    mockRowRenders = [];
    act(() => {
      tree.update(<MapBottomSheet {...props(users)} />);
    });
    expect(mockRowRenders).toEqual([]);
  });

  it('(por que o MapScreen segura as callbacks) onLike novo a cada resposta refaz toda linha montada', () => {
    const users = Array.from({ length: 300 }, (_, i) => person(i));
    let tree: ReactTestRenderer;
    act(() => {
      tree = create(<MapBottomSheet {...props(users)} onLike={() => {}} />);
      mounted.push(tree);
    });
    const rows = new Set(mockRowRenders).size;
    mockRowRenders = [];
    act(() => {
      tree.update(<MapBottomSheet {...props(users)} onLike={() => {}} />);
    });
    expect(mockRowRenders.length).toBe(rows);
  });
});
