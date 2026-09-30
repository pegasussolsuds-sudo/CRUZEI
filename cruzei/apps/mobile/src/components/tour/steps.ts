// Passos do tour do mapa (dados puros: textos, alvo e forma do recorte). A ordem é a do tour.

/** alvos do mapa que o tour destaca (cada um registrado por quem desenha o elemento) */
export const TOUR_TARGETS = ['me', 'people', 'vibe', 'visibility', 'locate', 'list', 'tabs'] as const;
export type TourTargetId = (typeof TOUR_TARGETS)[number];

export type TourStepId = 'welcome' | TourTargetId;

/** forma do recorte: círculo (cobre o maior lado), pílula (raio = metade da altura) ou retângulo arredondado */
export type TourShape = 'circle' | 'pill' | 'rect';

export interface TourStepDef {
  id: TourStepId;
  /** null = sem recorte (cartão no meio da tela) */
  target: TourTargetId | null;
  shape: TourShape;
  /** folga em volta do alvo (px) */
  pad: number;
  /** raio do retângulo (shape 'rect') */
  radius?: number;
  title: string;
  body: string;
  /** antes de medir: a câmera vai até mim (o boneco fica no centro da área livre do mapa) */
  focusMe?: boolean;
  /** espera antes de medir (câmera/lista assentando) */
  measureDelayMs?: number;
}

export const TOUR_STEPS: readonly TourStepDef[] = [
  {
    id: 'welcome',
    target: null,
    shape: 'rect',
    pad: 0,
    title: 'Bem-vindo ao Metch ✨',
    body: 'Um giro rapidinho pra você pegar o jeito do mapa. Leva uns 30 segundos.',
  },
  {
    id: 'me',
    target: 'me',
    shape: 'circle',
    pad: 0,
    title: 'Esse é você 👋',
    body: 'Seu boneco no mapa. Os outros te veem numa posição aproximada, nunca no seu endereço.',
    focusMe: true,
  },
  {
    id: 'people',
    target: 'people',
    shape: 'circle',
    pad: 0,
    title: 'Gente e lugares por perto 🔥',
    body: 'Cada boneco é alguém num raio de 350 m. Toca pra ver o perfil, curtir ou acenar. Lugar bombando brilha.',
  },
  {
    id: 'vibe',
    target: 'vibe',
    shape: 'pill',
    pad: 6,
    title: 'Onde tá a vibe? 🔎',
    body: 'Busca bares, baladas e eventos e vê onde tá mais movimentado agora.',
  },
  {
    id: 'visibility',
    target: 'visibility',
    shape: 'pill',
    pad: 6,
    title: 'Visível ou anônimo 👀',
    body: 'Você decide se aparece. No anônimo você vê todo mundo, mas ninguém sabe que é você.',
  },
  {
    id: 'locate',
    target: 'locate',
    shape: 'circle',
    pad: 8,
    title: 'Volta pra você 📍',
    body: 'Passeou pelo mapa? Esse botão te traz de volta pro seu lugar.',
  },
  {
    id: 'list',
    target: 'list',
    shape: 'rect',
    pad: 0,
    radius: 22,
    title: 'Quem tá por perto 👥',
    body: 'Puxa essa lista pra cima pra ver todo mundo perto de você, com curtir e passar à mão.',
  },
  {
    id: 'tabs',
    target: 'tabs',
    shape: 'rect',
    pad: 0,
    radius: 18,
    title: 'Curtidas e Mensagens 💬',
    body: 'Em Curtidas você passa ou curte quem tá perto, um de cada vez. Em Mensagens ficam suas conversas.',
  },
];

const BY_ID = new Map<TourStepId, TourStepDef>(TOUR_STEPS.map((s) => [s.id, s]));

export function tourStep(id: TourStepId): TourStepDef {
  return BY_ID.get(id) ?? TOUR_STEPS[0];
}

/** passos que dá pra mostrar agora (ex.: sem localização não tem "você no mapa"); boas-vindas sempre */
export function resolveTourSteps(isAvailable: (target: TourTargetId) => boolean): TourStepId[] {
  return TOUR_STEPS.filter((s) => s.target == null || isAvailable(s.target)).map((s) => s.id);
}

/** título do primeiro passo quando a pessoa pediu pra rever (não é mais boas-vindas) */
export const REPLAY_WELCOME_TITLE = 'Tour do mapa ✨';
