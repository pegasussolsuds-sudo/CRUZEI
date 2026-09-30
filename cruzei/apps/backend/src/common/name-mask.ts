/** bolinhas fixas depois da inicial: o tamanho do nome não vaza */
const DOTS = '•••';

/**
 * 'Ana Paula' → 'A••• P•••': o "Essa conta é sua?" mostra só a inicial de cada nome, sempre com 3 bolinhas (não
 * revela o tamanho de nada). Até 3 palavras. Sem nome vira '••••'.
 */
export function maskName(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 3);
  if (!words.length) return '••••';
  // Array.from: emoji/acentos compostos contam como 1
  return words.map((w) => Array.from(w)[0] + DOTS).join(' ');
}
