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
