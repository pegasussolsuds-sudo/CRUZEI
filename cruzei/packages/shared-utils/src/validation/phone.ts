// Phone BR — normaliza pra E.164 (+55...) e valida formato

export function normalizePhoneBR(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) {
    // celular ou fixo, sem DDI
    return `+55${digits}`;
  }
  if (digits.length === 12 && digits.startsWith('55')) {
    return `+${digits}`;
  }
  if (digits.length === 13 && digits.startsWith('55')) {
    return `+${digits}`;
  }
  return null;
}

export function isValidPhoneBR(raw: string): boolean {
  const norm = normalizePhoneBR(raw);
  if (!norm) return false;
  const local = norm.slice(3); // remove +55
  // 11 dígitos: celular (DDD + 9 + 8) — desde 2010
  // 10 dígitos: fixo (DDD + 8)
  if (local.length !== 10 && local.length !== 11) return false;
  const ddd = parseInt(local.slice(0, 2), 10);
  return ddd >= 11 && ddd <= 99;
}

/** os 67 DDDs em uso no Brasil (plano de numeração da Anatel) */
export const BR_DDDS: readonly number[] = [
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48,
  49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
];
const DDD_SET = new Set(BR_DDDS);

export type PhoneKindBR = 'mobile' | 'landline' | 'invalid';

/**
 * Tipo do número BR: celular = DDD válido + 9 + 8 dígitos; fixo = DDD válido + 8 dígitos começando com 2 a 5.
 * O resto (DDD que não existe, celular antigo sem o 9, número de outro país) é inválido.
 */
export function phoneKindBR(raw: string): PhoneKindBR {
  const norm = normalizePhoneBR(raw);
  if (!norm) return 'invalid';
  const local = norm.slice(3);
  if (!DDD_SET.has(parseInt(local.slice(0, 2), 10))) return 'invalid';
  if (local.length === 11) return local[2] === '9' ? 'mobile' : 'invalid';
  return /^[2-5]$/.test(local[2] ?? '') ? 'landline' : 'invalid';
}

/** celular brasileiro de verdade (o código de login vai por SMS) */
export function isMobilePhoneBR(raw: string): boolean {
  return phoneKindBR(raw) === 'mobile';
}

// Máscara pra exibir sem expor o número inteiro: +55 (34) 9****-9999
export function maskPhoneBR(raw: string): string {
  const norm = normalizePhoneBR(raw);
  if (!norm) return raw;
  const local = norm.slice(3); // DDD + número
  const ddd = local.slice(0, 2);
  const number = local.slice(2);
  const last4 = number.slice(-4);
  const first = number.length === 9 ? number[0] : '';
  const stars = '*'.repeat(number.length - last4.length - first.length);
  return `+55 (${ddd}) ${first}${stars}-${last4}`;
}

// Formata enquanto digita: (34) 99999-9999
export function formatPhoneBR(raw: string): string {
  const d = raw.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '').slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
