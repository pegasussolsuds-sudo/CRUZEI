import { main, parseArgs, UsageError } from './cli';

// só a leitura dos argumentos (nada aqui conecta no banco)

describe('parseArgs --assume-data', () => {
  const A = '20261004000100_passes_backfill';
  const B = '20261006000000_outro_backfill';

  it('aceita vários nomes depois do flag, separados por vírgula e o flag repetido', () => {
    expect(parseArgs(['baseline', '--assume-data', A, B]).lists.get('--assume-data')).toEqual([
      A,
      B,
    ]);
    expect(
      parseArgs(['baseline', '--assume-data', `${A},${B}`]).lists.get('--assume-data'),
    ).toEqual([A, B]);
    expect(
      parseArgs(['baseline', '--assume-data', A, '--up-to', B, '--assume-data', B]).lists.get(
        '--assume-data',
      ),
    ).toEqual([A, B]);
  });

  it('depois do 1º valor só pega o que tem cara de migration (o resto segue como comando)', () => {
    const args = parseArgs(['--assume-data', A, 'baseline', '--no-verify']);
    expect(args.lists.get('--assume-data')).toEqual([A]);
    expect(args.command).toBe('baseline');
    expect(args.flags.has('--no-verify')).toBe(true);
  });

  it('sem valor é erro de uso', () => {
    expect(() => parseArgs(['baseline', '--assume-data'])).toThrow(UsageError);
    expect(() => parseArgs(['baseline', '--assume-data', '--yes'])).toThrow(UsageError);
    expect(() => parseArgs(['baseline', '--assume-data', ','])).toThrow(UsageError);
  });

  it('fora do baseline: sai com 2 antes de tocar no banco', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(await main(['up', '--assume-data', A])).toBe(2);
      expect(err.mock.calls.map((c) => String(c[0])).join('\n')).toContain('só vale no baseline');
      expect(await main(['baseline', '--assume-data'])).toBe(2);
    } finally {
      err.mockRestore();
    }
  });
});
