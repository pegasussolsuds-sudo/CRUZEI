import { PRONOUN_ITEMS } from '@cruzei/shared-utils';
import React from 'react';
import { Text, View } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { PronounTag, pronounText } from '../PronounTag';

function mount(el: React.ReactElement): ReactTestRenderer {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(el);
  });
  return r;
}

describe('PronounTag', () => {
  it('id do catálogo vira o rótulo pt-BR; texto pronto passa direto; none/vazio somem', () => {
    expect(pronounText('ela')).toBe('ela/dela');
    expect(pronounText('elu')).toBe('elu/delu');
    expect(pronounText('any')).toBe('qualquer pronome');
    expect(pronounText('ele/dele')).toBe('ele/dele');
    expect(pronounText('none')).toBeNull();
    expect(pronounText('')).toBeNull();
    expect(pronounText(null)).toBeNull();
  });

  it('todas as opções do catálogo têm texto (menos "Não mostrar")', () => {
    const opts = PRONOUN_ITEMS;
    expect(opts.length).toBeGreaterThan(1);
    for (const o of opts) {
      if (o.id === 'none') expect(pronounText(o.id)).toBeNull();
      else expect(pronounText(o.id)).toMatch(/\S/);
    }
  });

  it('rótulo de acessibilidade "Pronomes: …" e texto visível, nos dois tamanhos', () => {
    for (const size of ['sm', 'md'] as const) {
      const r = mount(<PronounTag pronouns="ela" size={size} />);
      const pill = r.root.findAll((n) => n.type === View && n.props.accessibilityLabel != null)[0];
      expect(pill.props.accessibilityLabel).toBe('Pronomes: ela/dela');
      expect(r.root.findByType(Text).props.children).toBe('ela/dela');
    }
  });

  it('não renderiza nada sem pronomes', () => {
    expect(mount(<PronounTag pronouns="none" />).toJSON()).toBeNull();
  });
});
