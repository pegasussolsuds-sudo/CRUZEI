// Filtro de abuso (pt-BR) de mensagem, nome, bio e @ do Instagram. Função pura: o servidor decide com ela (400
// text_blocked / denúncia automática) e o app pode usar pra avisar antes de enviar. Listas em lexicon.ts.
//
// Política:
// - MENSAGEM: ódio, ameaça e sexual envolvendo menor → BLOQUEIA ("Essa mensagem fere as regras do Metch").
//   Golpe (Pix, pagamento, link encurtado…) → passa e vira denúncia automática (action 'flag'). Palavrão e conteúdo
//   sexual entre adultos → passa.
// - NOME, BIO e @: qualquer categoria → recusa com mensagem amigável dizendo o que ajustar.
import type { TextBlockedError, TextBlockReason, TextField } from '@cruzei/shared-types';

import {
  ALLOWLIST,
  HANDLE_SUBSTRINGS,
  LEXICON,
  MACROS,
  MINOR_AGE_BARE_NEXT,
  MINOR_AGE_NOT_AFTER,
  MINOR_AGE_UNDO_NEXT,
  MINOR_AGE_VERBS,
  MINOR_COMPARATIVE_AFTER,
  MINOR_FAMILY_WORDS,
  MINOR_PERSON_AGE_NEXT,
  MINOR_PERSON_WORDS,
  MINOR_PHRASES,
  MINOR_PRONOUNS,
  MINOR_SCHOOL_PHRASES,
  MINOR_SCHOOL_SELF,
  MINOR_SEXUAL_WORDS,
  MINOR_WORDS,
  RR_MACROS,
  SHORTENER_DOMAINS,
  SPELLED_NUMBERS,
  type LexiconScope,
} from './lexicon';
import { linkView, normalizeForFilter } from './normalize';

export type TextAction = 'allow' | 'flag' | 'block';

export interface TextHit {
  reason: TextBlockReason;
  /** trecho NORMALIZADO que bateu (log e moderação; nunca devolver pra tela como veio) */
  match: string;
}

export interface TextVerdict {
  /** allow: passa · flag: passa e gera denúncia automática (golpe em mensagem) · block: recusa (400 text_blocked) */
  action: TextAction;
  reason: TextBlockReason | null;
  match: string | null;
  /** texto amigável do 400 (só em block) */
  message: string | null;
}

/** texto maior que isso só tem o começo analisado (as rotas já limitam bem antes: mensagem 2000, bio 500) */
export const TEXT_FILTER_MAX_CHARS = 4000;

/** mensagem: o que BLOQUEIA (na ordem de gravidade); o resto, fora golpe, passa */
const MESSAGE_BLOCKS: readonly TextBlockReason[] = ['minor', 'threat', 'hate'];
/** nome, bio e @: tudo recusa; esta é só a ordem de qual motivo aparece quando há mais de um */
const PROFILE_ORDER: readonly TextBlockReason[] = ['minor', 'threat', 'hate', 'sexual', 'scam', 'profanity'];

/** texto do 400 por campo e motivo (a tela mostra como vem) */
export const TEXT_BLOCK_MESSAGES: Record<TextField, Record<TextBlockReason, string>> = {
  message: {
    hate: 'Essa mensagem fere as regras do Metch: ofensa por raça, orientação, identidade ou religião não rola aqui.',
    threat: 'Essa mensagem fere as regras do Metch: ameaça ou incentivo à violência não rola aqui.',
    minor: 'Essa mensagem fere as regras do Metch: conteúdo sexual envolvendo menor de idade é proibido.',
    profanity: 'Essa mensagem fere as regras do Metch.',
    sexual: 'Essa mensagem fere as regras do Metch.',
    scam: 'Essa mensagem fere as regras do Metch.',
  },
  name: {
    hate: 'Esse nome tem um termo ofensivo. Usa seu nome ou apelido de verdade.',
    threat: 'Esse nome não rola no Metch. Usa seu nome ou apelido de verdade.',
    minor: 'Esse nome não rola no Metch. Usa seu nome ou apelido de verdade.',
    profanity: 'Esse nome tem palavrão. Usa seu nome ou apelido de verdade 😉',
    sexual: 'Esse nome tem conteúdo sexual. Usa seu nome ou apelido de verdade 😉',
    scam: 'Nome não pode ter Pix, link, venda ou divulgação. Usa só seu nome ou apelido.',
  },
  bio: {
    hate: 'Sua bio tem um termo ofensivo (discriminação não rola aqui). Tira essa parte e tenta de novo.',
    threat: 'Sua bio tem um trecho que soa como ameaça. Ajusta essa parte e tenta de novo.',
    minor: 'Sua bio fala de algo sexual envolvendo menor de idade. Isso é proibido no Metch.',
    profanity: 'Sua bio tem palavrão ou xingamento. Deixa ela mais leve e tenta de novo 😉',
    sexual: 'Sua bio tem conteúdo sexual explícito. Guarda isso pras conversas e tenta de novo.',
    scam: 'Bio não pode ter pedido de Pix ou dinheiro, venda, divulgação nem link encurtado. Tira essa parte e tenta de novo.',
  },
  instagram: {
    hate: 'Esse @ tem um termo ofensivo. Coloca o seu @ pessoal.',
    threat: 'Esse @ não rola no Metch. Coloca o seu @ pessoal.',
    minor: 'Esse @ não rola no Metch. Coloca o seu @ pessoal.',
    profanity: 'Esse @ tem palavrão. Coloca o seu @ pessoal.',
    sexual: 'Esse @ tem conteúdo sexual. Coloca o seu @ pessoal.',
    scam: 'Esse @ parece de venda ou divulgação. Coloca o seu @ pessoal.',
  },
};

// ─────────────────────────── compilação das listas ───────────────────────────

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * troca {atalho} pelo trecho de MACROS (atalho desconhecido = erro, pego no teste). `rr`: o padrão casa na visão que
 * mantém "rr" — só aí valem os atalhos de RR_MACROS ({morrer}); fora dela também é erro.
 */
export function expandMacros(p: string, rr = false): string {
  return p.replace(/\{([a-z_]+)\}/g, (_, name: string) => {
    if (own(MACROS, name)) return MACROS[name];
    if (own(RR_MACROS, name)) {
      if (!rr) throw new Error(`filtro de abuso: atalho {${name}} só vale em padrão com rr: true`);
      return RR_MACROS[name];
    }
    throw new Error(`filtro de abuso: atalho desconhecido {${name}}`);
  });
}

interface Compiled {
  re: RegExp;
  c: TextBlockReason;
  in?: LexiconScope;
  /** casa na visão que mantém "rr" (MORRER ≠ MORAR), e só nela */
  rr: boolean;
  /** testado no texto ANTES do trecho (termina em espaço): casou = achado cancelado */
  notAfter?: RegExp;
}

const COMPILED: readonly Compiled[] = LEXICON.map((e) => ({
  // palavra inteira: começo do texto ou espaço antes; espaço ou fim depois
  re: new RegExp(`(?:^| )(?:${expandMacros(e.p, e.rr)})(?= |$)`, e.notAfter ? 'g' : ''),
  c: e.c,
  in: e.in,
  rr: e.rr === true,
  notAfter: e.notAfter ? new RegExp(`(?:^| )(?:${expandMacros(e.notAfter, e.rr)}) $`) : undefined,
}));

/** 1º trecho que bate no texto (pulando os cancelados pelo notAfter) */
function matchEntry(e: Compiled, view: string): string | null {
  if (!e.notAfter) {
    const m = e.re.exec(view);
    return m ? m[0].trim() : null;
  }
  e.re.lastIndex = 0;
  for (let m = e.re.exec(view); m; m = e.re.exec(view)) {
    const start = m.index + (m[0].startsWith(' ') ? 1 : 0);
    if (!e.notAfter.test(view.slice(0, start))) return m[0].trim();
    e.re.lastIndex = m.index + 1;
  }
  return null;
}

const ALLOW_RES: readonly RegExp[] = ALLOWLIST.map((a) => new RegExp(`(^| )${a}(?= |$)`, 'g'));

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SHORTENER_RE = new RegExp(
  `(?:^|[^a-z0-9.])(?:${SHORTENER_DOMAINS.map(escapeRe).join('|')})(?:$|[^a-z0-9.])`,
);

const SEXUAL = new Set(MINOR_SEXUAL_WORDS);
const MINOR_WORD_SET = new Set(MINOR_WORDS);
const MINOR_PHRASE_LIST = MINOR_PHRASES.map((p) => p.split(' '));
const SCHOOL_PHRASE_LIST = MINOR_SCHOOL_PHRASES.map((p) => p.split(' '));
const SCHOOL_SELF = new Set(MINOR_SCHOOL_SELF);
/** entre quem fala e a série: "tô NO ensino fundamental", "sou DA oitava série", "ainda to no" */
const SCHOOL_GLUE = new Set(['no', 'na', 'do', 'da', 'o', 'a', 'em', 'ainda', 'so']);
const COMPARATIVE = new Set(MINOR_COMPARATIVE_AFTER);
const PERSON = new Set(MINOR_PERSON_WORDS);
const PRONOUNS = new Set(MINOR_PRONOUNS);
const AGE_VERBS = new Set(MINOR_AGE_VERBS);
const FAMILY = new Set(MINOR_FAMILY_WORDS);
const NOT_AFTER = new Set(MINOR_AGE_NOT_AFTER);
const BARE_NEXT = new Set(MINOR_AGE_BARE_NEXT);
const PERSON_AGE_NEXT = new Set(MINOR_PERSON_AGE_NEXT);
/** o que desfaz a idade, palavra a palavra ("de maio" = ['de', 'maio']) */
const AGE_UNDO_LIST = MINOR_AGE_UNDO_NEXT.map((p) => p.split(' '));
const DIGITS = /^[0-9]+$/;
const AGE_UNITS = new Set(['anos', 'ano', 'aninhos', 'aninho']);
const MINOR_AGE = /^(?:[1-9]|1[0-7])$/;
/** idade sem "anos" ("tenho 16 e…"): só adolescente, pra não pegar "tenho 2 e quero mais" (filhos) */
const MINOR_AGE_BARE = /^1[0-7]$/;

function scopeApplies(scope: LexiconScope | undefined, field: TextField): boolean {
  if (!scope) return true;
  if (scope === 'profile') return field !== 'message';
  if (scope === 'instagram') return field === 'instagram';
  return field === 'name' || field === 'instagram';
}

// Map (e não o objeto direto): "constructor" digitado não pode virar função do protótipo
const NUMBERS = new Map(Object.entries(SPELLED_NUMBERS));

/** "quinze" → "15" (palavra inteira; ver SPELLED_NUMBERS) */
export function spelledNumbersToDigits(view: string): string {
  return view
    .split(' ')
    .map((t) => NUMBERS.get(t) ?? t)
    .join(' ');
}

/** tira os trechos inocentes (ALLOWLIST) e deixa um marcador que não casa com nada */
function applyAllowlist(view: string): string {
  let v = view;
  for (const re of ALLOW_RES) v = v.replace(re, '$1~');
  return v;
}

// ─────────────────────────── menor de idade + termo sexual por perto ───────────────────────────

/** família/bicho logo antes ("minha filha de 8 anos", "meus filhos crianças") */
function familyBefore(tokens: readonly string[], i: number): boolean {
  for (let k = Math.max(0, i - 3); k < i; k++) if (FAMILY.has(tokens[k])) return true;
  return false;
}

const startsAt = (tokens: readonly string[], i: number, ph: readonly string[]) =>
  ph.every((w, k) => tokens[i + k] === w);

/**
 * depois de "menina de N" / "novinha N" (sem "anos"). Regra fixa, sem olhar o resto da frase:
 * - desfaz: MINOR_AGE_UNDO_NEXT (cidade, medida, dinheiro, tempo, contagem, "de <mês>") ou outro número logo depois
 *   ("menina de Sete Lagoas", "garota de Treze Tílias", "menina de Quinze de Novembro", "menino de 1,90");
 * - N em dígito ou de DEZ a DEZESSETE por extenso: idade ("menina de quinze gosta de sexo", "novinha de 15 gatinha…");
 * - N de DOIS a NOVE por extenso (nome de cidade é comum: "Três Pontas", "Dois Irmãos"): só com fim do texto,
 *   MINOR_AGE_BARE_NEXT, termo sexual, MINOR_PERSON_AGE_NEXT ou "a fim" logo depois.
 * `src` = as mesmas palavras antes do número por extenso virar dígito (igual = veio em dígito).
 */
function personAgeNext(tokens: readonly string[], src: readonly string[], i: number): boolean {
  const next = tokens[i + 1];
  if (next === undefined) return true;
  if (DIGITS.test(next) || AGE_UNDO_LIST.some((ph) => startsAt(tokens, i + 1, ph))) return false;
  if (src[i] === tokens[i] || MINOR_AGE_BARE.test(tokens[i])) return true;
  if (BARE_NEXT.has(next) || SEXUAL.has(next) || PERSON_AGE_NEXT.has(next)) return true;
  return next === 'a' && tokens[i + 2] === 'fim';
}

/**
 * "N anos" de alguém: "tenho 16 anos", "tenho 16 anos de idade", "tenho 16 e quero…", "novinha 15", "menina de 14",
 * "ela tem 16 anos" (nunca tempo nem família). Devolve a posição de onde a janela do termo sexual conta (o número, ou
 * "anos" em "16 anos de idade", pra "de idade" não comer a janela), ou -1 se não é idade.
 * `src`: as mesmas palavras antes do número por extenso virar dígito ("sete" continua "sete").
 */
function ageIndicatorEnd(tokens: readonly string[], src: readonly string[], i: number): number {
  const n = tokens[i];
  if (!MINOR_AGE.test(n)) return -1;
  const next = tokens[i + 1];
  const hasAnos = AGE_UNITS.has(next ?? '');
  // "3 anos de casada", "2 anos que", "5 anos sem" é tempo; "16 anos DE IDADE" é idade
  const deIdade = hasAnos && tokens[i + 2] === 'de' && tokens[i + 3] === 'idade';
  if (hasAnos && !deIdade && NOT_AFTER.has(tokens[i + 2] ?? '')) return -1;
  if (familyBefore(tokens, i)) return -1;
  const end = deIdade ? i + 2 : i;
  // sem "anos": "tenho 17 e quero transar" conta, "tenho 17 de casada" e "tenho 2 filhos" não
  const age = hasAnos || (MINOR_AGE_BARE.test(n) && (next === undefined || BARE_NEXT.has(next)));
  const p1 = tokens[i - 1] ?? '';
  const p2 = tokens[i - 2] ?? '';
  const glue = p1 === 'de' || p1 === 'tem' || p1 === 'com' || p1 === 'so' || p1 === 'tipo';
  // "menina de 14", "novinha 15": a palavra depois do número decide (cidade e medida não são idade)
  if (PERSON.has(p1) || (glue && PERSON.has(p2))) return hasAnos || personAgeNext(tokens, src, i) ? end : -1;
  if (AGE_VERBS.has(p1)) return age ? end : -1;
  if (PRONOUNS.has(p2) && p1 === 'tem' && age) return end;
  return -1;
}

/** "sou do ensino fundamental", "tô na oitava série", "menina da quinta série" (não "professora do ensino…") */
function schoolSelfBefore(tokens: readonly string[], i: number): boolean {
  for (let k = i - 1; k >= Math.max(0, i - 3); k--) {
    if (SCHOOL_SELF.has(tokens[k]) || PERSON.has(tokens[k])) return true;
    if (!SCHOOL_GLUE.has(tokens[k])) return false;
  }
  return false;
}

/**
 * acha "indicador de menor" com um termo sexual a até `win` palavras (antes ou depois). `view`: número por extenso já
 * em dígito; `src`: a mesma visão antes disso (palavra a palavra, pra saber se a idade veio por extenso)
 */
function minorProximity(view: string, src: string): string | null {
  const tokens = view.split(' ');
  const srcTokens = src.split(' ');
  const sexual: number[] = [];
  tokens.forEach((t, i) => {
    if (SEXUAL.has(t)) sexual.push(i);
  });
  if (!sexual.length) return null;
  const nearest = (from: number, to: number, win: number): number | null => {
    for (const j of sexual) if (j >= from - win && j <= to + win && (j < from || j > to)) return j;
    return null;
  };
  for (let i = 0; i < tokens.length; i++) {
    if (MINOR_WORD_SET.has(tokens[i]) && !familyBefore(tokens, i)) {
      const j = nearest(i, i, 3);
      if (j !== null) return `${tokens[i]} … ${tokens[j]}`;
    }
    for (const ph of MINOR_PHRASE_LIST) {
      if (!startsAt(tokens, i, ph) || familyBefore(tokens, i)) continue;
      // "com menor frequência", "de menor risco": comparação, não idade
      if (ph[ph.length - 1] === 'menor' && COMPARATIVE.has(tokens[i + ph.length] ?? '')) continue;
      const j = nearest(i, i + ph.length - 1, 4);
      if (j !== null) return `${ph.join(' ')} … ${tokens[j]}`;
    }
    for (const ph of SCHOOL_PHRASE_LIST) {
      if (!startsAt(tokens, i, ph) || familyBefore(tokens, i) || !schoolSelfBefore(tokens, i)) continue;
      const j = nearest(i, i + ph.length - 1, 4);
      if (j !== null) return `${ph.join(' ')} … ${tokens[j]}`;
    }
    const end = ageIndicatorEnd(tokens, srcTokens, i);
    if (end >= 0) {
      const j = nearest(i, end, 6);
      if (j !== null) return `${tokens[i]} anos … ${tokens[j]}`;
    }
  }
  return null;
}

// ─────────────────────────── busca ───────────────────────────

/**
 * Tudo o que bate no texto pra este campo (no máximo um achado por motivo). Vazio = limpo.
 * O @ chega sem o "@" ou com; ponto e _ separam palavras ("joao.pix" → "joao pix").
 */
export function findAbuse(text: string | null | undefined, field: TextField): TextHit[] {
  const raw = (text ?? '').slice(0, TEXT_FILTER_MAX_CHARS);
  if (!raw.trim()) return [];
  const input = field === 'instagram' ? raw.replace(/[._]+/g, ' ') : raw;
  const views = normalizeForFilter(input);
  const leet = applyAllowlist(views.leet);
  const plain = applyAllowlist(views.plain);
  // "rr" preservado: só pros padrões `rr` (MORRER: "morra viado" ≠ "mora gay no prédio")
  const rr = applyAllowlist(views.rr);
  // idade por extenso ("tenho quinze anos" → "tenho 15 anos"): só pro que é de menor (valor de golpe fica como veio)
  const ages = spelledNumbersToDigits(plain);
  const hits = new Map<TextBlockReason, string>();

  for (const e of COMPILED) {
    if (hits.has(e.c) || !scopeApplies(e.in, field)) continue;
    let m: string | null;
    if (e.rr) m = matchEntry(e, rr);
    else {
      const alt = e.c === 'minor' ? ages : plain;
      m = matchEntry(e, leet) ?? (alt !== leet ? matchEntry(e, alt) : null);
    }
    if (m) hits.set(e.c, m);
  }

  if (!hits.has('minor')) {
    const m = minorProximity(ages, plain);
    if (m) hits.set('minor', m);
  }

  if (!hits.has('scam')) {
    const lv = linkView(raw);
    const m = SHORTENER_RE.exec(lv);
    if (m) hits.set('scam', m[0].replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ''));
  }

  // @ colado ("joaocaralho"): pedaços longos e inequívocos
  if (field === 'instagram') {
    const glued = views.leet.replace(/ /g, '');
    for (const h of HANDLE_SUBSTRINGS) {
      if (!hits.has(h.c) && glued.includes(h.s)) hits.set(h.c, h.s);
    }
  }

  return [...hits].map(([reason, match]) => ({ reason, match }));
}

const ALLOW: TextVerdict = { action: 'allow', reason: null, match: null, message: null };

/** decisão pro campo: allow / flag (golpe em mensagem → denúncia automática) / block (400 text_blocked) */
export function checkText(text: string | null | undefined, field: TextField): TextVerdict {
  const hits = findAbuse(text, field);
  if (!hits.length) return ALLOW;
  const by = new Map(hits.map((h) => [h.reason, h.match]));
  if (field === 'message') {
    for (const r of MESSAGE_BLOCKS) {
      const match = by.get(r);
      if (match !== undefined) return { action: 'block', reason: r, match, message: TEXT_BLOCK_MESSAGES.message[r] };
    }
    const scam = by.get('scam');
    if (scam !== undefined) return { action: 'flag', reason: 'scam', match: scam, message: null };
    return ALLOW;
  }
  for (const r of PROFILE_ORDER) {
    const match = by.get(r);
    if (match !== undefined) return { action: 'block', reason: r, match, message: TEXT_BLOCK_MESSAGES[field][r] };
  }
  return ALLOW;
}

/** corpo do 400 text_blocked (TextBlockedError) a partir de um veredito 'block' */
export function textBlockedError(field: TextField, verdict: Pick<TextVerdict, 'reason' | 'message'>): TextBlockedError {
  const reason = verdict.reason ?? 'profanity';
  return {
    error: 'text_blocked',
    message: verdict.message ?? TEXT_BLOCK_MESSAGES[field][reason],
    field,
    reason,
  };
}

/** nome, bio e @ de uma vez (cadastro, editar perfil): o 1º campo recusado, ou null se tudo passa */
export function checkProfileText(p: {
  name?: string | null;
  bio?: string | null;
  instagram?: string | null;
}): TextBlockedError | null {
  const fields: [TextField, string | null | undefined][] = [
    ['name', p.name],
    ['bio', p.bio],
    ['instagram', p.instagram],
  ];
  for (const [field, value] of fields) {
    if (!value) continue;
    const v = checkText(value, field);
    if (v.action === 'block') return textBlockedError(field, v);
  }
  return null;
}
