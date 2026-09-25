export function formatBRL(cents: number): string {
  const reais = cents / 100;
  return reais.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export const MAP_NAME_MAX = 14;
const NAME_PARTICLES = new Set(['da', 'de', 'do', 'das', 'dos', 'e', 'di', 'del', 'van', 'von']);

/**
 * Nome curto pro rótulo do mapa (brief FOTO AVATAR §5): primeiro nome + inicial do sobrenome
 * ("Leonardo Silva" → "Leonardo S."), pulando partículas ("João da Silva" → "João S."). Nunca passa de
 * `max` caracteres: se não couber, fica só o primeiro nome (truncado com … em último caso).
 */
export function formatMapName(name: string | null | undefined, max = MAP_NAME_MAX): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const first = words[0];
  // inicial = primeiro CARACTERE (não code unit: emoji/acentos) de uma palavra que comece com letra ("Ana 🌸 Lima" → "Ana L.")
  let initial: string | null = null;
  for (const w of words.slice(1)) {
    if (NAME_PARTICLES.has(w.toLowerCase())) continue;
    const ch = Array.from(w)[0] ?? '';
    if (/\p{L}/u.test(ch)) {
      initial = ch.toUpperCase();
      break;
    }
  }
  const short = initial ? `${first} ${initial}.` : first;
  if (Array.from(short).length <= max) return short;
  const chars = Array.from(first);
  return chars.length <= max ? first : `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}
