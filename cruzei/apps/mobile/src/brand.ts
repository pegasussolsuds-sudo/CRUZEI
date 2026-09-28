// Marca do produto — única fonte de verdade pro nome que aparece na interface.
// ID nas lojas: app.metch (Android e iOS, decidido em 28/09/2026, antes da 1ª publicação). Scopes @cruzei/*, chaves de
// storage e pastas continuam "cruzei" (codinome técnico).

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
