import { describe, expect, it } from 'vitest';
import {
  audienceError,
  BIG_AUDIENCE,
  channelsError,
  confirmationMatches,
  describeAudience,
  describeChannels,
  describeTarget,
  needsTypedConfirmation,
  targetError,
} from './audience';

describe('público', () => {
  it('descreve cada tipo', () => {
    expect(describeAudience({ kind: 'all' })).toBe('Todo mundo');
    expect(describeAudience({ kind: 'city', city: ' Uberlândia ' })).toBe('Quem está em Uberlândia');
    expect(describeAudience({ kind: 'radius', lat: 0, lng: 0, radiusM: 2500 })).toBe('Até 2,5 km do ponto');
  });

  it('valida o que falta', () => {
    expect(audienceError({ kind: 'city', city: ' ' })).toBe('Diz qual cidade.');
    expect(audienceError({ kind: 'radius', lat: -18.9, lng: -48.2, radiusM: 50 })).toMatch(/raio/);
    expect(audienceError({ kind: 'radius', lat: 200, lng: -48.2, radiusM: 1000 })).toMatch(/centro/);
    expect(audienceError({ kind: 'user', userId: '' })).toBe('Escolhe a pessoa.');
    expect(audienceError({ kind: 'premium' })).toBeNull();
  });

  it('confirmação digitada: todo mundo sempre, os outros acima do limite', () => {
    expect(needsTypedConfirmation({ kind: 'all' }, 3)).toBe(true);
    expect(needsTypedConfirmation({ kind: 'premium' }, BIG_AUDIENCE)).toBe(false);
    expect(needsTypedConfirmation({ kind: 'premium' }, BIG_AUDIENCE + 1)).toBe(true);
  });

  it('aceita o número com ou sem ponto de milhar', () => {
    expect(confirmationMatches('1.234', 1234)).toBe(true);
    expect(confirmationMatches('1234', 1234)).toBe(true);
    expect(confirmationMatches('1 234', 1234)).toBe(true);
    expect(confirmationMatches('1233', 1234)).toBe(false);
    expect(confirmationMatches('mil', 1000)).toBe(false);
    expect(confirmationMatches('', 0)).toBe(false);
  });
});

describe('canais e destino', () => {
  it('canais', () => {
    expect(describeChannels({ push: true, inbox: true })).toBe('Push + central de avisos');
    expect(channelsError({ push: false, inbox: false })).not.toBeNull();
    expect(channelsError({ push: false, inbox: true })).toBeNull();
  });

  it('destino do toque', () => {
    expect(describeTarget(null)).toBe('Abre o app');
    expect(describeTarget({ kind: 'event', eventId: 'e1' })).toBe('Abre o evento');
    expect(targetError({ kind: 'event', eventId: '' })).not.toBeNull();
    expect(targetError({ kind: 'place', poiId: 'p1' })).toBeNull();
    expect(targetError(null)).toBeNull();
  });
});
