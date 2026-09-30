import { AGE_RANGE_SAVE_DELAY_MS, createAgeRangeDraft, type AgeRange } from './ageRangeDraft';

// Soltar o polegar só grava depois de 1,5 s parado: "de" + "até" em seguida = 1 mudança das 5 do dia.

function setup(start: AgeRange = [18, 99]) {
  let saved: AgeRange = start;
  const save = jest.fn();
  const shown: (AgeRange | null)[] = [];
  const d = createAgeRangeDraft({ saved: () => saved, save, onDraft: (x) => shown.push(x) });
  // o /me mudou (otimista ou volta do erro)
  const setSaved = (r: AgeRange) => {
    saved = r;
    d.savedChanged();
  };
  return { d, save, shown, setSaved };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('rascunho da faixa de idade', () => {
  it('mexer no "de" e no "até" em seguida grava UMA vez, com o valor final', () => {
    const { d, save } = setup();
    d.change(25, 99);
    jest.advanceTimersByTime(AGE_RANGE_SAVE_DELAY_MS - 100);
    d.change(25, 40);
    jest.advanceTimersByTime(AGE_RANGE_SAVE_DELAY_MS - 1);
    expect(save).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(25, 40);
  });

  it('voltou pro valor gravado antes do prazo: não grava nada', () => {
    const { d, save } = setup([25, 35]);
    d.change(30, 35);
    d.change(25, 35);
    jest.advanceTimersByTime(AGE_RANGE_SAVE_DELAY_MS);
    expect(save).not.toHaveBeenCalled();
    expect(d.draft()).toBeNull();
  });

  it('o rascunho segura a tela até o valor gravado mudar (sem piscar o antigo)', () => {
    const { d, setSaved } = setup([25, 35]);
    d.change(30, 40);
    jest.advanceTimersByTime(AGE_RANGE_SAVE_DELAY_MS);
    expect(d.draft()).toEqual([30, 40]);
    setSaved([30, 40]); // otimista
    expect(d.draft()).toBeNull();
    // o servidor recusou (429): volta pro antigo, o rascunho não reaparece
    setSaved([25, 35]);
    expect(d.draft()).toBeNull();
  });

  it('mexeu de novo antes do /me mudar: o rascunho novo fica e grava no prazo', () => {
    const { d, save, setSaved } = setup([25, 35]);
    d.change(30, 40);
    jest.advanceTimersByTime(AGE_RANGE_SAVE_DELAY_MS);
    d.change(31, 40);
    setSaved([30, 40]);
    expect(d.draft()).toEqual([31, 40]);
    jest.advanceTimersByTime(AGE_RANGE_SAVE_DELAY_MS);
    expect(save.mock.calls).toEqual([
      [30, 40],
      [31, 40],
    ]);
  });

  it('saiu da tela: grava na hora o que ficou (uma vez só)', () => {
    const { d, save } = setup();
    d.change(20, 30);
    d.flush();
    d.flush();
    jest.advanceTimersByTime(AGE_RANGE_SAVE_DELAY_MS);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(20, 30);
  });
});
