import { Controller, Get, Header, Param } from '@nestjs/common';
import { LegalService } from './legal.service';

// Textos pro app (sem login: a tela de boas-vindas mostra antes do cadastro)
@Controller('legal-docs')
export class LegalDocsController {
  constructor(private readonly legal: LegalService) {}

  @Get()
  list() {
    return this.legal.list();
  }

  @Get(':slug')
  one(@Param('slug') slug: string) {
    return this.legal.get(slug);
  }
}

// Páginas públicas fora do prefixo da API (/legal/privacidade → URL da política na ficha das lojas)
@Controller('legal')
export class LegalPagesController {
  constructor(private readonly legal: LegalService) {}

  @Get(':slug')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  page(@Param('slug') slug: string) {
    return this.legal.html(slug);
  }
}
