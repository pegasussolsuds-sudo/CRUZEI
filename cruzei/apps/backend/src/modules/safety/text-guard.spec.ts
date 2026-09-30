import { BadRequestException } from '@nestjs/common';

import { autoReportDescription } from './auto-report';
import { screenMessage } from './text-guard';

// Ponto de checagem das mensagens: o grave vira 400 text_blocked (nada é gravado), golpe passa com o trecho pra
// denúncia automática, palavrão entre adultos passa.

describe('screenMessage', () => {
  it.each([
    ['vou te matar', 'threat'],
    ['seu macaco', 'hate'],
    ['manda nudes de novinha de 15', 'minor'],
  ])('%s → 400 text_blocked (%s)', (text, reason) => {
    let err: unknown;
    try {
      screenMessage(text);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BadRequestException);
    const body = (err as BadRequestException).getResponse() as Record<string, unknown>;
    expect(body).toMatchObject({ error: 'text_blocked', field: 'message', reason });
    expect(String(body.message)).toMatch(/^Essa mensagem fere as regras do Metch/);
  });

  it('golpe passa e devolve o trecho', () => {
    expect(screenMessage('me manda um pix de 50').scam).toContain('pix');
    expect(screenMessage('olha isso bit.ly/abc').scam).toBe('bit.ly');
  });

  it('conversa normal e palavrão entre adultos passam sem denúncia', () => {
    expect(screenMessage('porra, que dia foda')).toEqual({ scam: null });
    expect(screenMessage('vou te matar de saudade')).toEqual({ scam: null });
  });

  it('descrição da denúncia automática: curta e com o trecho', () => {
    expect(autoReportDescription('me manda um pix')).toBe(
      'Filtro automático: possível golpe numa mensagem ("me manda um pix")',
    );
    expect(autoReportDescription('x'.repeat(300)).length).toBeLessThan(200);
  });
});
