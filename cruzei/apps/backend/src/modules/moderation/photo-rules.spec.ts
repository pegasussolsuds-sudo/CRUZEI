import { judgePhoto } from './photo-rules';

describe('judgePhoto', () => {
  it('aprova foto sem rótulos e com adulto', () => {
    const v = judgePhoto([], [{ AgeRange: { Low: 24, High: 32 } }]);
    expect(v.decision).toBe('approve');
    expect(v.labels).toEqual(['idade aparente 24–32']);
  });

  it('aprova foto de praia (roupa de banho não é motivo)', () => {
    expect(judgePhoto([{ Name: 'Swimwear or Underwear', Confidence: 97 }], []).decision).toBe('approve');
  });

  it('recusa nudez explícita com confiança alta', () => {
    const v = judgePhoto([{ Name: 'Exposed Female Nipple', ParentName: 'Explicit', Confidence: 93 }], []);
    expect(v.decision).toBe('reject');
    expect(v.reason).toBe('Nudez ou conteúdo explícito');
  });

  it('manda pra revisão o explícito com confiança média (a máquina não recusa sozinha)', () => {
    expect(judgePhoto([{ Name: 'Explicit Nudity', Confidence: 70 }], []).decision).toBe('review');
  });

  it('manda sugestivo pra revisão', () => {
    const v = judgePhoto([{ Name: 'Suggestive', Confidence: 66 }], []);
    expect(v).toMatchObject({ decision: 'review', reason: 'Suggestive', urgent: false });
  });

  it('ignora rótulo abaixo de 60 %', () => {
    expect(judgePhoto([{ Name: 'Suggestive', Confidence: 41 }], []).decision).toBe('approve');
  });

  it('possível menor de idade nunca é aprovado sozinho e é urgente', () => {
    const v = judgePhoto([], [{ AgeRange: { Low: 25, High: 31 } }, { AgeRange: { Low: 13, High: 19 } }]);
    expect(v).toMatchObject({ decision: 'review', urgent: true, reason: 'Possível menor de idade na foto' });
  });

  it('explícito com possível menor: recusa e marca urgente', () => {
    const v = judgePhoto([{ Name: 'Explicit', Confidence: 95 }], [{ AgeRange: { Low: 14, High: 20 } }]);
    expect(v).toMatchObject({ decision: 'reject', urgent: true });
  });
});
