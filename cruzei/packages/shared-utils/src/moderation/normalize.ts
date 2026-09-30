// Normalização do filtro de abuso: deixa "V14D0", "p.u.t.a", "viaaaado", "v i a d o" e "Você" no mesmo formato
// das listas (lexicon.ts). Sem \p{…} nem lookbehind (roda também no app, em Hermes).

const ACCENTS: Record<string, string> = {
  'á': 'a', 'à': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a', 'å': 'a', 'ª': 'a',
  'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
  'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i',
  'ó': 'o', 'ò': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o', 'º': 'o',
  'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u',
  'ç': 'c', 'ñ': 'n', 'ý': 'y', 'ÿ': 'y',
  // letras de outros alfabetos (cirílico) que parecem as nossas: disfarce comum
  '\u0430': 'a', '\u0435': 'e', '\u043e': 'o', '\u0440': 'p', '\u0441': 'c', '\u0443': 'y', '\u0445': 'x',
  '\u0456': 'i', '\u043a': 'k', '\u043c': 'm', '\u0442': 't', '\u0432': 'b', '\u043d': 'h',
};

/** leetspeak dentro de palavra com letra: 0→o 1→i 3→e 4→a 5→s 7→t @→a $→s */
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };

/** caracteres invisíveis usados pra quebrar palavra ("vi\u200bado") */
const INVISIBLE = /[\u00ad\u200b-\u200f\u2060-\u2064\ufeff]/g;

/**
 * "colas" dentro da palavra: somem ("p.u.t.a", "vi-ado", "c*u" viram uma palavra só). O resto que não é letra nem
 * número (vírgula, !, ?, emoji…) separa palavras.
 */
const JOINERS = /[.\-_*'\u2019`\u00b4~^#|]/g;

/** minúsculas, sem acento, sem invisível (a base de todas as visões) */
export function foldText(input: string): string {
  let s = (input ?? '').toLowerCase().replace(INVISIBLE, '');
  try {
    s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch {
    // sem normalize: o mapa abaixo cobre o português
  }
  return s.replace(/[^\x00-\x7f]/g, (ch) => ACCENTS[ch] ?? ch);
}

/** letra repetida vira uma só ("viaaado" → "viado", "porra" → "pora"); número não ("11 anos" continua) */
export function collapseRepeats(word: string): string {
  return word.replace(/([a-z])\1+/g, '$1');
}

/**
 * igual a collapseRepeats, mas "rr" fica "rr" (e "rrr…" vira "rr"): "morra" ≠ "mora", "morrrre" → "morre",
 * "moooorra" → "morra". É o que separa MORRER de MORAR sem adivinhar pelo contexto.
 */
export function collapseKeepRr(word: string): string {
  return word.replace(/([a-z])\1+/g, (_, ch: string) => (ch === 'r' ? 'rr' : ch));
}

type Collapse = (word: string) => string;

/** 3+ letras soltas seguidas viram uma palavra ("v i a d o" → "viado") */
function joinSpelled(tokens: string[], collapse: Collapse = collapseRepeats): string[] {
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length >= 3) out.push(collapse(run.join('')));
    else out.push(...run);
    run = [];
  };
  for (const t of tokens) {
    if (t.length === 1 && t >= 'a' && t <= 'z') run.push(t);
    else {
      flush();
      out.push(t);
    }
  }
  flush();
  return out;
}

/** pedaços brutos: separa por espaço e pontuação (as "colas" ficam, pra sumir depois) */
function rawPieces(folded: string): string[] {
  return folded
    .replace(/[^a-z0-9@$.\-_*'\u2019`\u00b4~^#|]+/g, ' ')
    .split(' ')
    .filter(Boolean);
}

/**
 * Visão "leet": dígitos/@/$ no meio de palavra com letra viram letra ("v14d0" → "viado", "put@" → "puta"); número
 * sozinho fica ("15"). @ no começo (menção) some.
 */
function leetWord(piece: string, collapse: Collapse = collapseRepeats): string {
  let w = piece.replace(/^@+/, '');
  if (/[a-z]/.test(w)) w = w.replace(/[0-9@$]/g, (ch) => LEET[ch] ?? ch);
  return collapse(w.replace(JOINERS, '').replace(/[^a-z0-9]/g, ''));
}

/** visão "plain": sem trocar dígito; letra e número se separam ("viado123" → "viado 123", "novinha15" → "novinha 15") */
function plainWords(piece: string): string[] {
  const w = piece.replace(JOINERS, '').replace(/[^a-z0-9]/g, '');
  return (w.match(/[a-z]+|[0-9]+/g) ?? []).map(collapseRepeats);
}

export interface NormalizedText {
  /** com leetspeak desfeito; palavras separadas por 1 espaço */
  leet: string;
  /** sem leetspeak (dígitos preservados e separados das letras); pra idade e valores */
  plain: string;
  /**
   * igual à leet, mas com "rr" preservado ("m0rrrra viaaado" → "morra viado"; "mora" continua "mora"): só pros
   * padrões marcados `rr` no lexicon.ts (formas de MORRER, que na leet colidem com MORAR)
   */
  rr: string;
}

/** as visões do texto que o filtro compara com as listas */
export function normalizeForFilter(input: string): NormalizedText {
  const pieces = rawPieces(foldText(input));
  const leet = joinSpelled(pieces.map((p) => leetWord(p)).filter(Boolean));
  const plain = joinSpelled(pieces.flatMap(plainWords));
  const rr = joinSpelled(
    pieces.map((p) => leetWord(p, collapseKeepRr)).filter(Boolean),
    collapseKeepRr,
  );
  return { leet: leet.join(' '), plain: plain.join(' '), rr: rr.join(' ') };
}

/** atalho: a visão principal (leetspeak desfeito) — "V14D0!!!" → "viado" */
export function normalizeText(input: string): string {
  return normalizeForFilter(input).leet;
}

/**
 * Texto pra achar link disfarçado: minúsculas, sem acento, e o ponto disfarçado vira ponto de verdade
 * ("bit . ly", "bit(.)ly", "bit[.]ly", "bit ponto ly" → "bit.ly").
 */
export function linkView(input: string): string {
  return foldText(input)
    .replace(INVISIBLE, '')
    .replace(/\s*[([{]\s*(?:\.|dot|ponto)\s*[)\]}]\s*/g, '.')
    .replace(/\s+(?:dot|ponto)\s+/g, '.')
    .replace(/\s*\.\s*/g, '.')
    .replace(/\s*\/\s*/g, '/');
}
