// Marca do produto — única fonte de verdade pro nome que aparece na interface.
// Identificadores técnicos (pacote com.cruzei.app, scopes @cruzei/*, chaves de storage) NÃO mudam
// junto com a marca: trocar o applicationId desinstalaria o app de quem já tem.

export const BRAND = {
  /** nome próprio, como aparece em frases ("O Metch mostra…") */
  name: 'Metch',
  /** wordmark em caixa baixa (logo tipográfico) */
  wordmark: 'metch',
  /** grito do match — o momento em que dois caminhos se cruzam */
  matchShout: 'METCH!',
  tagline: 'quem você quase conheceu hoje',
  supportEmail: 'suporte@metch.app',
  version: '0.1.0',
} as const;
