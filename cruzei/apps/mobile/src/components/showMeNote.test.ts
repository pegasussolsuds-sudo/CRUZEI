import { SHOW_ME_RECIPROCAL_NOTE } from './showMeNote';

describe('aviso do "Mostrar" recíproco', () => {
  it('diz que a escolha pode ser percebida com contas de gêneros diferentes, curto (cabe em 2–3 linhas nos 360 dp)', () => {
    expect(SHOW_ME_RECIPROCAL_NOTE).toMatch(/dois lados/);
    expect(SHOW_ME_RECIPROCAL_NOTE).toMatch(/contas de gêneros diferentes/);
    expect(SHOW_ME_RECIPROCAL_NOTE.length).toBeLessThanOrEqual(120);
  });
});
