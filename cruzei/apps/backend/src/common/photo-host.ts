import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Hosts que podem servir fotos: o próprio backend (host da requisição) + PHOTO_ALLOWED_HOSTS (R2/CDN em prod).
 * Toda URL de imagem que outra pessoa vai baixar (bolha do mapa, cartão, mídia do chat) passa por aqui: URL de fora
 * vira pixel de rastreio / oráculo de quem está perto.
 */
export function assertPhotoHost(url: string, req: Request): void {
  let host: string;
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    throw new BadRequestException('URL de foto inválida');
  }
  const allowed = new Set(
    [req.get('host') ?? '', ...(process.env.PHOTO_ALLOWED_HOSTS ?? '').split(',')].map((h) => h.trim().toLowerCase()).filter(Boolean),
  );
  // dev: o app fala com o backend por 127.0.0.1/localhost/IP da LAN (túnel USB ou Wi-Fi) — mesma porta, hosts equivalentes
  const port = (req.get('host') ?? '').split(':')[1];
  if (port) ['127.0.0.1', 'localhost'].forEach((h) => allowed.add(`${h}:${port}`));
  if (!allowed.has(host)) throw new BadRequestException('Foto precisa estar hospedada pelo Metch');
}
