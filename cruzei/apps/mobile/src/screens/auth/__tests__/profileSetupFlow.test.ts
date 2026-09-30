import { ONBOARDING_STEPS } from '@cruzei/shared-types';

import {
  PHASES,
  SETUP_STEPS,
  TOTAL_STEPS,
  buildRegisterInput,
  checkInstagram,
  phaseFill,
  phaseProgress,
  precheckStep,
  stepErrorOf,
  stepIndexOf,
  type SetupState,
} from '../profileSetupFlow';

const http = (status: number, data?: unknown) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });

const base: SetupState = {
  phone: '+5534999990000',
  name: '  Ana   Paula ',
  birthDate: '1995-01-01',
  gender: 'female',
  showMe: 'men',
  orientation: null,
  showOrientation: true,
  sameOrientationFirst: true,
  lookingFor: 'casual',
  interests: [],
  bio: '',
  instagram: '',
  anonymous: false,
  termsVersion: '1.2',
};

describe('etapas do cadastro', () => {
  it('seguem a ordem do funil das métricas (ONBOARDING_STEPS, de name a prefs)', () => {
    const funnel = ONBOARDING_STEPS.slice(ONBOARDING_STEPS.indexOf('name'), ONBOARDING_STEPS.indexOf('prefs') + 1);
    expect(SETUP_STEPS.map((s) => s.track)).toEqual(funnel);
  });

  it('interesses, bio e Instagram são opcionais e ficam juntos em "Seu perfil"', () => {
    const optional = SETUP_STEPS.filter((s) => s.phase === 'profile');
    expect(optional.map((s) => s.key)).toEqual(['interests', 'bio', 'instagram']);
    expect(optional.every((s) => s.optional)).toBe(true);
    // obrigatórias continuam obrigatórias
    for (const k of ['name', 'birth', 'gender', 'showMe', 'looking', 'prefs'] as const) {
      expect(SETUP_STEPS[stepIndexOf(k)].optional).toBeFalsy();
    }
  });

  it('a barra mostra a fase: "Sobre você · 1 de 3" … "Última etapa"', () => {
    expect(TOTAL_STEPS).toBe(10);
    expect(PHASES).toHaveLength(4);
    expect(phaseProgress(0).counter).toBe('Sobre você · 1 de 3');
    expect(phaseProgress(stepIndexOf('looking')).counter).toBe('O que você procura · 3 de 3');
    expect(phaseProgress(stepIndexOf('bio'))).toMatchObject({ phaseIndex: 2, indexInPhase: 1, phaseSize: 3 });
    expect(phaseProgress(stepIndexOf('prefs')).counter).toBe('Última etapa');
  });

  it('preenchimento dos pedaços: fases passadas cheias, a atual proporcional, as próximas vazias', () => {
    expect(phaseFill(0)).toEqual([1 / 3, 0, 0, 0]);
    expect(phaseFill(stepIndexOf('interests'))).toEqual([1, 1, 1 / 3, 0]);
    expect(phaseFill(stepIndexOf('prefs'))).toEqual([1, 1, 1, 1]);
  });
});

describe('@ do Instagram ao vivo', () => {
  it('vazio, válido (normalizado) ou inválido', () => {
    expect(checkInstagram('')).toEqual({ state: 'empty' });
    expect(checkInstagram('  @ ')).toEqual({ state: 'empty' });
    expect(checkInstagram('@Ana.Souza')).toEqual({ state: 'ok', handle: 'ana.souza' });
    expect(checkInstagram('https://www.instagram.com/ana_1/?hl=pt')).toEqual({ state: 'ok', handle: 'ana_1' });
    expect(checkInstagram('.ana')).toEqual({ state: 'invalid' });
    expect(checkInstagram('ana souza')).toEqual({ state: 'invalid' });
  });
});

describe('corpo do cadastro', () => {
  it('etapas puladas não mandam nada; orientação ausente leva as chaves junto', () => {
    const r = buildRegisterInput(base);
    expect(r).toEqual({
      phone: '+5534999990000',
      name: 'Ana Paula',
      birthDate: '1995-01-01',
      gender: 'female',
      lookingFor: 'casual',
      termsVersion: '1.2',
      showMe: 'men',
      visibilityMode: 'visible',
    });
  });

  it('com tudo preenchido: bio sem as pontas, @ normalizado, interesses sem repetido, orientação com as chaves', () => {
    const r = buildRegisterInput({
      ...base,
      showMe: null,
      orientation: 'bisexual',
      showOrientation: true,
      sameOrientationFirst: false,
      interests: ['Música', 'Praia', 'Música'],
      bio: '  café e samba  ',
      instagram: '@Ana.Souza',
      anonymous: true,
    });
    expect(r).toMatchObject({
      showMe: 'everyone',
      visibilityMode: 'anonymous',
      orientation: 'bisexual',
      showOrientation: true,
      sameOrientationFirst: false,
      interests: ['Música', 'Praia'],
      bio: 'café e samba',
      instagram: 'ana.souza',
    });
  });

  it('@ inválido não vai (a etapa não deixa seguir, mas o corpo nunca leva lixo)', () => {
    expect(buildRegisterInput({ ...base, instagram: '.ana' })).not.toHaveProperty('instagram');
  });

  it('interesses cortados no máximo de 10', () => {
    const many = Array.from({ length: 13 }, (_, i) => `i${i}`);
    expect(buildRegisterInput({ ...base, interests: many }).interests).toHaveLength(10);
  });
});

describe('filtro de abuso antes de seguir', () => {
  const s = { name: 'Ana', bio: 'café e praia', instagram: 'ana.souza' };

  it('texto limpo e etapas sem texto passam', () => {
    for (const step of ['name', 'bio', 'instagram', 'gender', 'prefs'] as const) {
      expect(precheckStep(step, s)).toBeNull();
    }
    expect(precheckStep('bio', { ...s, bio: '' })).toBeNull();
    expect(precheckStep('instagram', { ...s, instagram: '' })).toBeNull();
  });

  it('nome com palavrão ou bio com ameaça/Pix: fica na etapa com a mensagem do que ajustar', () => {
    expect(precheckStep('name', { ...s, name: 'Caralho' })).toEqual({ step: 'name', message: expect.stringMatching(/nome/i) });
    expect(precheckStep('bio', { ...s, bio: 'vou te matar' })?.step).toBe('bio');
    expect(precheckStep('bio', { ...s, bio: 'me manda um pix' })?.message).toMatch(/Pix/);
  });
});

describe('erro do cadastro → etapa', () => {
  it('filtro de abuso volta pra etapa do campo com a mensagem do servidor', () => {
    expect(stepErrorOf(http(400, { error: 'text_blocked', field: 'bio', reason: 'hate', message: 'Tira isso da bio' }))).toEqual({
      step: 'bio',
      message: 'Tira isso da bio',
    });
    expect(stepErrorOf(http(400, { error: 'text_blocked', field: 'name', reason: 'profanity', message: 'Troca o nome' }))?.step).toBe(
      'name',
    );
    expect(stepErrorOf(http(400, { error: 'text_blocked', field: 'instagram', reason: 'scam', message: 'x' }))?.step).toBe('instagram');
  });

  it('@ fora da regra → Instagram; nome curto → nome; menor de 18 → nascimento', () => {
    expect(stepErrorOf(http(400, { error: 'instagram_invalid', message: 'Esse @ não rola' }))).toEqual({
      step: 'instagram',
      message: 'Esse @ não rola',
    });
    expect(stepErrorOf(http(400, { error: 'name_invalid', message: 'curto' }))?.step).toBe('name');
    expect(stepErrorOf(http(400, { error: 'underage', message: 'Só 18+' }))).toEqual({ step: 'birth', message: 'Só 18+' });
  });

  it('rede, número já cadastrado e 5xx ficam na última etapa (null)', () => {
    expect(stepErrorOf(new Error('Network Error'))).toBeNull();
    expect(stepErrorOf(http(401, { message: 'Telefone já cadastrado' }))).toBeNull();
    expect(stepErrorOf(http(500))).toBeNull();
  });
});
