// Decisão automática sobre uma foto a partir da análise da Rekognition (DetectModerationLabels + DetectFaces).
// Regra de ouro: a máquina só APROVA o que é claramente ok e só RECUSA o que é claramente explícito; o resto
// (sugestivo, violência, possível menor de idade) fica pendente pra um moderador decidir.

import { isProduction } from '../../config/security';

export interface ModerationLabelIn {
  Name?: string;
  ParentName?: string;
  Confidence?: number;
}

export interface FaceAgeIn {
  AgeRange?: { Low?: number; High?: number };
}

export interface PhotoVerdict {
  decision: 'approve' | 'reject' | 'review';
  /** motivo curto (vai pra pessoa quando recusada, e pra fila quando revisão) */
  reason: string | null;
  /** rótulos legíveis pra fila da moderação */
  labels: string[];
  /** revisão com prioridade (possível menor de idade) */
  urgent: boolean;
}

/** recusa automática com confiança ≥ 80 % (nudez explícita, ato sexual, ódio, violência gráfica) */
const REJECT = new Set([
  'Explicit',
  'Explicit Nudity',
  'Exposed Male Genitalia',
  'Exposed Female Genitalia',
  'Exposed Buttocks or Anus',
  'Exposed Female Nipple',
  'Explicit Sexual Activity',
  'Sexual Activity',
  'Graphic Male Nudity',
  'Graphic Female Nudity',
  'Illustrated Explicit Nudity',
  'Sex Toys',
  'Adult Toys',
  'Hate Symbols',
  'Nazi Party',
  'White Supremacy',
  'Extremist',
  'Graphic Violence',
  'Graphic Violence Or Gore',
]);
export const REJECT_MIN = 80;

/** revisão humana com confiança ≥ 60 % */
const REVIEW = new Set([
  'Non-Explicit Nudity of Intimate parts and Kissing',
  'Non-Explicit Nudity',
  'Partially Exposed Female Breast',
  'Implied Nudity',
  'Obstructed Intimate Parts',
  'Suggestive',
  'Violence',
  'Physical Violence',
  'Weapon Violence',
  'Weapons',
  'Self-Harm',
  'Self Injury',
  'Visually Disturbing',
  'Emaciated Bodies',
  'Corpses',
  'Drugs',
  'Drug Use',
  'Drug Products',
  'Drug Paraphernalia',
  'Pills',
  'Rude Gestures',
  'Middle Finger',
]);
export const REVIEW_MIN = 60;
// "Swimwear or Underwear", "Alcohol", "Tobacco", "Gambling": liberados (foto de praia e de bar é normal num app de encontros)

/** idade aparente mínima abaixo disso → um humano confere (nunca aprova sozinho) */
export const MINOR_AGE = 18;

export function judgePhoto(labels: ModerationLabelIn[], faces: FaceAgeIn[]): PhotoVerdict {
  const seen: string[] = [];
  let reject: string | null = null;
  let review: string | null = null;
  for (const l of labels) {
    const conf = l.Confidence ?? 0;
    const names = [l.Name, l.ParentName].filter((n): n is string => Boolean(n));
    if (!names.length || conf < REVIEW_MIN) continue;
    seen.push(`${l.Name} ${Math.round(conf)}%`);
    if (!reject && conf >= REJECT_MIN && names.some((n) => REJECT.has(n)))
      reject = l.Name ?? l.ParentName ?? 'conteúdo explícito';
    else if (!review && names.some((n) => REVIEW.has(n) || REJECT.has(n)))
      review = l.Name ?? l.ParentName ?? 'conteúdo sensível';
  }
  let minor = false;
  for (const f of faces) {
    const lo = f.AgeRange?.Low;
    const hi = f.AgeRange?.High;
    if (lo === undefined) continue;
    seen.push(`idade aparente ${lo}–${hi ?? '?'}`);
    if (lo < MINOR_AGE) minor = true;
  }
  if (reject)
    return {
      decision: 'reject',
      reason: 'Nudez ou conteúdo explícito',
      labels: seen,
      urgent: minor,
    };
  if (minor)
    return {
      decision: 'review',
      reason: 'Possível menor de idade na foto',
      labels: seen,
      urgent: true,
    };
  if (review) return { decision: 'review', reason: review, labels: seen, urgent: false };
  return { decision: 'approve', reason: null, labels: seen, urgent: false };
}

export type PhotoModerationMode = 'off' | 'manual' | 'rekognition';

/**
 * PHOTO_MODERATION: off (foto vai ao ar na hora — só dev), manual (fica em análise até um moderador aprovar) ou
 * rekognition (análise automática da AWS; o que não é claro vai pra fila humana). Produção nunca sobe com "off".
 */
export function photoModerationMode(env: NodeJS.ProcessEnv = process.env): PhotoModerationMode {
  const v = (env.PHOTO_MODERATION ?? '').trim().toLowerCase();
  if (v === 'off' || v === 'manual' || v === 'rekognition') return v;
  // sem NODE_ENV conta como produção: nunca "off" por esquecimento
  return isProduction(env) ? 'rekognition' : 'off';
}
