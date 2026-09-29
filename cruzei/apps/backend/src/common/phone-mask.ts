/**
 * +55 34 9••••-1234: o moderador confere o número sem ver ele inteiro (só admin vê o telefone completo).
 * Número curto demais pra mascarar com sentido vira só '••••'.
 */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const d = phone.replace(/\D/g, '');
  return d.length < 8
    ? '••••'
    : `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 5)}••••-${d.slice(-4)}`;
}
