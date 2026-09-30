// Regras puras do cadastro (ProfileSetup): etapas na ordem do funil (ONBOARDING_STEPS), fases da barra de progresso,
// o que vai no POST /auth/register e pra qual etapa voltar quando o servidor recusa um campo. Sem React (testável).
import {
  PROFILE_LIMITS,
  type Gender,
  type LookingFor,
  type OnboardingStep,
  type Orientation,
  type ShowMe,
} from '@cruzei/shared-types';
import { checkProfileText, isValidInstagramHandle, normalizeInstagramHandle } from '@cruzei/shared-utils';

import { profileFieldErrorOf } from '../../services/fieldError';
import type { RegisterInput } from '../../stores/auth';

export type StepKey =
  | 'name'
  | 'birth'
  | 'gender'
  | 'showMe'
  | 'orientation'
  | 'looking'
  | 'interests'
  | 'bio'
  | 'instagram'
  | 'prefs';

export type PhaseKey = 'you' | 'match' | 'profile' | 'ready';

export interface SetupStep {
  key: StepKey;
  /** etapa no funil das métricas (ONBOARDING_STEPS) */
  track: OnboardingStep;
  phase: PhaseKey;
  /** dá pra pular (o botão vira "Pular" enquanto está vazio) */
  optional?: boolean;
  title: string;
  hint: string;
}

/**
 * 10 etapas em 4 fases: a barra mostra a fase (4 pedaços), não "07 / 10" — parece mais curto e as opcionais ficam
 * juntas no fim ("Seu perfil", tudo pulável). A ordem é a mesma do funil (ONBOARDING_STEPS).
 */
export const SETUP_STEPS: readonly SetupStep[] = [
  { key: 'name', track: 'name', phase: 'you', title: 'Qual seu nome?', hint: 'É assim que as pessoas vão te ver no mapa.' },
  {
    key: 'birth',
    track: 'birth',
    phase: 'you',
    title: 'Quando você nasceu?',
    hint: 'Só pra garantir que você tem 18+. A idade aparece no perfil, a data não.',
  },
  { key: 'gender', track: 'gender', phase: 'you', title: 'Como você se identifica?', hint: 'Isso ajuda a mostrar seu perfil pra quem faz sentido.' },
  {
    key: 'showMe',
    track: 'show_me',
    phase: 'match',
    title: 'Quem você quer ver?',
    hint: 'Vale pros dois lados: você só aparece pra quem também quer te ver. Dá pra mudar no Perfil.',
  },
  {
    key: 'orientation',
    track: 'orientation',
    phase: 'match',
    optional: true,
    title: 'Sua orientação',
    hint: 'Opcional, e só aparece no perfil se você quiser. Se preferir, pula.',
  },
  { key: 'looking', track: 'looking', phase: 'match', title: 'O que você procura?', hint: 'Dá pra mudar depois, sem drama.' },
  {
    key: 'interests',
    track: 'interests',
    phase: 'profile',
    optional: true,
    title: 'Do que você curte?',
    hint: `Escolhe até ${PROFILE_LIMITS.interestsMax}. Ajuda a puxar assunto e a achar quem curte o mesmo.`,
  },
  {
    key: 'bio',
    track: 'bio',
    phase: 'profile',
    optional: true,
    title: 'Conta um pouco de você',
    hint: 'Uma ou duas frases já rendem papo. Aparece no seu perfil.',
  },
  {
    key: 'instagram',
    track: 'instagram',
    phase: 'profile',
    optional: true,
    title: 'Seu Instagram',
    hint: 'Aparece no seu perfil pra quem abrir. Deixa vazio se não quiser mostrar.',
  },
  {
    key: 'prefs',
    track: 'prefs',
    phase: 'ready',
    title: 'Como você quer aparecer?',
    hint: 'Quem cruzou seu caminho num raio de até 350 m aparece no mapa. Você decide se te veem.',
  },
];

export const PHASES: readonly { key: PhaseKey; label: string }[] = [
  { key: 'you', label: 'Sobre você' },
  { key: 'match', label: 'O que você procura' },
  { key: 'profile', label: 'Seu perfil' },
  { key: 'ready', label: 'Última etapa' },
];

export const TOTAL_STEPS = SETUP_STEPS.length;

export function stepIndexOf(key: StepKey): number {
  return SETUP_STEPS.findIndex((s) => s.key === key);
}

export interface PhaseProgress {
  phaseIndex: number;
  /** 0-based dentro da fase */
  indexInPhase: number;
  phaseSize: number;
  label: string;
  /** texto curto do topo: "SOBRE VOCÊ · 2 DE 3" / "ÚLTIMA ETAPA" */
  counter: string;
}

export function phaseProgress(stepIndex: number): PhaseProgress {
  const i = Math.min(Math.max(0, stepIndex), TOTAL_STEPS - 1);
  const phase = SETUP_STEPS[i].phase;
  const phaseIndex = PHASES.findIndex((p) => p.key === phase);
  const inPhase = SETUP_STEPS.filter((s) => s.phase === phase);
  const indexInPhase = inPhase.findIndex((s) => s.key === SETUP_STEPS[i].key);
  const label = PHASES[phaseIndex].label;
  const counter = inPhase.length > 1 ? `${label} · ${indexInPhase + 1} de ${inPhase.length}` : label;
  return { phaseIndex, indexInPhase, phaseSize: inPhase.length, label, counter };
}

/** fração preenchida de cada pedaço da barra (0..1) pra etapa atual: fases passadas cheias, a atual pela metade etc. */
export function phaseFill(stepIndex: number): number[] {
  const { phaseIndex, indexInPhase, phaseSize } = phaseProgress(stepIndex);
  return PHASES.map((_, p) => (p < phaseIndex ? 1 : p > phaseIndex ? 0 : (indexInPhase + 1) / phaseSize));
}

// ── @ do Instagram (validação ao vivo, mesma regra do servidor) ─────────────────────────────────────────────────

export type InstagramCheck = { state: 'empty' } | { state: 'ok'; handle: string } | { state: 'invalid' };

export function checkInstagram(raw: string): InstagramCheck {
  const handle = normalizeInstagramHandle(raw);
  if (handle == null) return { state: 'empty' };
  return isValidInstagramHandle(handle) ? { state: 'ok', handle } : { state: 'invalid' };
}

// ── corpo do cadastro ─────────────────────────────────────────────────────────────────────────────────────────

export interface SetupState {
  phone: string;
  name: string;
  /** 'AAAA-MM-DD' */
  birthDate: string;
  gender: Gender;
  showMe: ShowMe | null;
  /** null = não escolheu / "Prefiro não dizer" */
  orientation: Orientation | null;
  showOrientation: boolean;
  sameOrientationFirst: boolean;
  lookingFor: LookingFor;
  interests: readonly string[];
  bio: string;
  instagram: string;
  anonymous: boolean;
  termsVersion: string;
}

/**
 * RegisterInput a partir do que a pessoa preencheu. Etapas puladas não mandam nada (nem string vazia); o @ vai já
 * normalizado; a orientação só com as duas chaves junto (consentimento); installId quem põe é o store.
 */
export function buildRegisterInput(s: SetupState): RegisterInput {
  const bio = s.bio.trim();
  const insta = checkInstagram(s.instagram);
  const interests = [...new Set(s.interests)].slice(0, PROFILE_LIMITS.interestsMax);
  return {
    phone: s.phone,
    name: s.name.replace(/\s+/g, ' ').trim(),
    birthDate: s.birthDate,
    gender: s.gender,
    lookingFor: s.lookingFor,
    termsVersion: s.termsVersion,
    showMe: s.showMe ?? 'everyone',
    // a conta já nasce no modo escolhido (invisível ganha a janela grátis de 24 h no servidor)
    visibilityMode: s.anonymous ? 'anonymous' : 'visible',
    ...(s.orientation
      ? { orientation: s.orientation, showOrientation: s.showOrientation, sameOrientationFirst: s.sameOrientationFirst }
      : {}),
    ...(interests.length ? { interests } : {}),
    ...(bio ? { bio: bio.slice(0, PROFILE_LIMITS.bioMax) } : {}),
    ...(insta.state === 'ok' ? { instagram: insta.handle } : {}),
  };
}

// ── filtro de abuso antes de seguir (mesma função do servidor, que confere de novo) ────────────────────────────

/**
 * Nome, bio e @ passam pelo filtro de abuso ao apertar "Continuar": avisa na própria etapa em vez de só no fim do
 * cadastro. Outras etapas (ou texto limpo) → null.
 */
export function precheckStep(step: StepKey, s: { name: string; bio: string; instagram: string }): StepError | null {
  let text: { name?: string; bio?: string; instagram?: string | null } | null = null;
  if (step === 'name') text = { name: s.name.trim() };
  else if (step === 'bio') text = { bio: s.bio.trim() };
  else if (step === 'instagram') {
    const c = checkInstagram(s.instagram);
    text = { instagram: c.state === 'ok' ? c.handle : null };
  }
  if (!text) return null;
  const blocked = checkProfileText(text);
  return blocked ? { step, message: blocked.message } : null;
}

// ── erro do cadastro → etapa ──────────────────────────────────────────────────────────────────────────────────

export interface StepError {
  step: StepKey;
  message: string;
}

/**
 * O servidor recusou um campo (filtro de abuso, @ fora da regra, nome curto, menor de 18): volta pra etapa dele com a
 * mensagem. Outros erros (rede, número já cadastrado, 5xx) ficam na última etapa → null.
 */
export function stepErrorOf(err: unknown): StepError | null {
  const f = profileFieldErrorOf(err);
  if (f) return { step: f.field, message: f.message };
  const res = (err as { response?: { status?: number; data?: { error?: unknown; message?: unknown } } } | null)?.response;
  if (res?.status === 400 && res.data?.error === 'underage') {
    return {
      step: 'birth',
      message: typeof res.data.message === 'string' ? res.data.message : 'O Metch é só pra maiores de 18.',
    };
  }
  return null;
}
