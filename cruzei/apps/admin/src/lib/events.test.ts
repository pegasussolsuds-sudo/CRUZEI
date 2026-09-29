import { describe, expect, it } from 'vitest';
import type { AdminEvent } from '@cruzei/shared-types';
import { duplicateEventForm, EMPTY_EVENT_FORM, eventFormToPayload, eventPhase, eventToForm, eventWhenText, validateEventForm } from './events';
import { addDays, fromLocalInput, localInputFromNow, toLocalInput } from './datetime';

const NOW = Date.parse('2026-09-29T15:00:00Z'); // 12:00 em Brasília

describe('fase do evento', () => {
  const base = { startsAt: '2026-09-29T20:00:00Z', endsAt: '2026-09-30T02:00:00Z' };
  it('status manda antes do horário', () => {
    expect(eventPhase({ ...base, status: 'draft' }, NOW)).toBe('draft');
    expect(eventPhase({ ...base, status: 'cancelled' }, NOW)).toBe('cancelled');
  });
  it('publicado: antes, durante, depois', () => {
    expect(eventPhase({ ...base, status: 'published' }, NOW)).toBe('upcoming');
    expect(eventPhase({ ...base, status: 'published' }, Date.parse('2026-09-29T21:00:00Z'))).toBe('live');
    expect(eventPhase({ ...base, status: 'published' }, Date.parse('2026-09-30T02:00:00Z'))).toBe('past');
  });
});

describe('horário de Brasília nos inputs', () => {
  it('ida e volta sem depender do fuso da máquina', () => {
    expect(fromLocalInput('2026-09-29T21:30')).toBe('2026-09-30T00:30:00.000Z');
    expect(toLocalInput('2026-09-30T00:30:00.000Z')).toBe('2026-09-29T21:30');
    expect(fromLocalInput('')).toBeNull();
    expect(fromLocalInput('29/09/2026 21:30')).toBeNull();
    expect(toLocalInput('lixo')).toBe('');
  });

  it('padrões dos formulários', () => {
    expect(localInputFromNow(60, Date.parse('2026-09-29T15:07:00Z'))).toBe('2026-09-29T13:05');
    expect(addDays(30, NOW)).toBe('2026-10-29T15:00:00.000Z');
  });
});

describe('formulário', () => {
  const ok = {
    ...EMPTY_EVENT_FORM,
    title: 'Sunset no Sabiá',
    startsAt: '2026-09-29T17:00',
    endsAt: '2026-09-29T22:00',
    lat: -18.9,
    lng: -48.2,
  };

  it('válido não tem erro', () => {
    expect(validateEventForm(ok, { isNew: true, now: NOW })).toEqual({});
  });

  it('aponta cada problema', () => {
    const e = validateEventForm({ ...ok, title: 'a', endsAt: '2026-09-29T16:00', lat: null, coverUrl: 'ftp://x' }, { isNew: true, now: NOW });
    expect(e.title).toBeTruthy();
    expect(e.endsAt).toMatch(/depois/);
    expect(e.where).toBeTruthy();
    expect(e.coverUrl).toBeTruthy();
  });

  it('evento novo no passado é engano; editar evento antigo não', () => {
    const past = { ...ok, startsAt: '2026-09-28T10:00', endsAt: '2026-09-28T12:00' };
    expect(validateEventForm(past, { isNew: true, now: NOW }).endsAt).toMatch(/passou/);
    expect(validateEventForm(past, { isNew: false, now: NOW }).endsAt).toBeUndefined();
  });

  it('payload limpa vazios e converte horário', () => {
    const p = eventFormToPayload({ ...ok, description: '  ', venueName: ' Parque do Sabiá ', coverUrl: '' });
    expect(p).toMatchObject({
      title: 'Sunset no Sabiá',
      description: null,
      venueName: 'Parque do Sabiá',
      coverUrl: null,
      startsAt: '2026-09-29T20:00:00.000Z',
      endsAt: '2026-09-30T01:00:00.000Z',
      lat: -18.9,
      lng: -48.2,
      poiId: null,
    });
  });

  it('evento → formulário → payload preserva os dados', () => {
    const ev: AdminEvent = {
      id: 'e1',
      title: 'Festa',
      description: 'Muito bom',
      category: 'party',
      status: 'draft',
      startsAt: '2026-10-01T23:00:00.000Z',
      endsAt: '2026-10-02T04:00:00.000Z',
      venueName: 'Galpão',
      lat: -18.91,
      lng: -48.27,
      address: 'Rua X, 10',
      city: 'Uberlândia',
      coverUrl: 'https://img.exemplo/capa.jpg',
      poiId: 'p1',
      mapPoiId: null,
      createdBy: null,
      createdAt: '2026-09-20T10:00:00.000Z',
      publishedAt: null,
      cancelledAt: null,
      announcements: [],
    };
    const payload = eventFormToPayload(eventToForm(ev));
    expect(payload).toEqual({
      title: ev.title,
      description: ev.description,
      category: ev.category,
      startsAt: ev.startsAt,
      endsAt: ev.endsAt,
      venueName: ev.venueName,
      lat: ev.lat,
      lng: ev.lng,
      address: ev.address,
      city: ev.city,
      coverUrl: ev.coverUrl,
      poiId: ev.poiId,
    });
  });
});

describe('duplicar evento', () => {
  it('mesmos dados, datas uma semana depois (mesma hora de Brasília)', () => {
    const ev: AdminEvent = {
      id: 'e1',
      title: 'Festa',
      description: null,
      category: 'party',
      status: 'published',
      startsAt: '2026-10-01T23:00:00.000Z',
      endsAt: '2026-10-02T04:00:00.000Z',
      venueName: 'Galpão',
      lat: -18.91,
      lng: -48.27,
      address: null,
      city: 'Uberlândia',
      coverUrl: null,
      poiId: 'p1',
      mapPoiId: '99',
      createdBy: null,
      createdAt: '2026-09-20T10:00:00.000Z',
      publishedAt: '2026-09-21T10:00:00.000Z',
      cancelledAt: null,
      announcements: [],
    };
    const f = duplicateEventForm(ev);
    expect(f.startsAt).toBe('2026-10-08T20:00');
    expect(f.endsAt).toBe('2026-10-09T01:00');
    expect(f).toMatchObject({ title: 'Festa', venueName: 'Galpão', poiId: 'p1', city: 'Uberlândia', category: 'party' });
    expect(duplicateEventForm(ev, 1).startsAt).toBe('2026-10-02T20:00');
  });
});

describe('texto de quando é o evento (aviso)', () => {
  // NOW = 12:00 de 29/09 em Brasília
  const at = (startsAt: string, endsAt = '2026-10-10T00:00:00Z') => eventWhenText({ startsAt, endsAt }, NOW);
  it('compara o DIA em Brasília, não "menos de 24 h"', () => {
    expect(at('2026-09-29T23:00:00Z')).toBe('Hoje às 20:00');
    // 10 h de amanhã (menos de 24 h daqui): é amanhã, não hoje
    expect(at('2026-09-30T13:00:00Z')).toBe('Amanhã às 10:00');
    // 01:30 UTC do dia 30 = 22:30 do dia 29 em Brasília: ainda é hoje
    expect(at('2026-09-30T01:30:00Z')).toBe('Hoje às 22:30');
    // 23:30 de amanhã em Brasília
    expect(at('2026-10-01T02:30:00Z')).toBe('Amanhã às 23:30');
    expect(at('2026-10-03T22:00:00Z')).toBe('Dia 03/10 às 19:00');
  });
  it('já começou e não terminou: rolando agora', () => {
    expect(at('2026-09-29T14:00:00Z', '2026-09-29T20:00:00Z')).toBe('Rolando agora');
  });
});
