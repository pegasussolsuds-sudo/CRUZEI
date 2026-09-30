// Filtro de abuso (pt-BR): normalização + listas + decisão por campo
export * from './normalize';
export * from './text-filter';
export {
  LEXICON,
  MACROS,
  RR_MACROS,
  ALLOWLIST,
  SHORTENER_DOMAINS,
  type LexiconEntry,
  type LexiconScope,
} from './lexicon';
