// @ do Instagram no perfil (público: aparece no cartão pra todo mundo). Guardado SEM o @ e em minúsculas.
// Mesma regra do Instagram: letras a-z, números, ponto e _ (1 a 30), sem ponto no início/fim e sem '..'.
// O banco confere a mesma regra (CHECK users_instagram_handle_chk).

export const INSTAGRAM_HANDLE_MAX = 30;

export const INSTAGRAM_HANDLE_RE = /^(?!.*\.\.)(?!\.)(?!.*\.$)[a-z0-9._]{1,30}$/;

/**
 * Limpa o que a pessoa digitou ou colou: espaços, link do perfil (https://www.instagram.com/fulano/?hl=pt), @ e
 * maiúsculas. NÃO valida: passe o resultado em isValidInstagramHandle. Vazio → null (apagar o @).
 */
export function normalizeInstagramHandle(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let s = raw.trim();
  // link do perfil → só o 1º segmento do caminho (instagram.com/fulano/reels → fulano)
  s = s.replace(/^(?:https?:\/\/)?(?:www\.|m\.)?(?:instagram\.com|instagr\.am)\/+/i, '');
  s = (s.split(/[?#]/)[0] ?? '').split('/')[0] ?? '';
  s = s.replace(/^@+/, '').trim().toLowerCase();
  return s || null;
}

export function isValidInstagramHandle(handle: string | null | undefined): handle is string {
  return typeof handle === 'string' && INSTAGRAM_HANDLE_RE.test(handle);
}

/** link que o app abre ao tocar no @ */
export function instagramUrl(handle: string): string {
  return `https://instagram.com/${handle}`;
}
