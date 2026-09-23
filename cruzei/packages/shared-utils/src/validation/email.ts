// Email simples — só pra signup secundário

export function isValidEmail(raw: string): boolean {
  // RFC 5322 simplificado — cobre 99% dos casos
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);
}
