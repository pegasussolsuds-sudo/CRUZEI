import {
  likePushText,
  matchPushText,
  messagePreviewOf,
  messagePushText,
  oneLine,
  PREVIEW_MAX,
} from './social-push.texts';

// Textos do push social: a curtida nunca nomeia quem não pode ser nomeado, a prévia só com a preferência ligada e a
// solicitação com cara de solicitação.

describe('oneLine / messagePreviewOf', () => {
  it('uma linha só, sem espaço repetido, cortada com reticências', () => {
    expect(oneLine('  oi\n\ntudo   bem? ', 50)).toBe('oi tudo bem?');
    const long = 'a'.repeat(PREVIEW_MAX + 30);
    const cut = messagePreviewOf('text', long)!;
    expect(cut).toHaveLength(PREVIEW_MAX);
    expect(cut.endsWith('…')).toBe(true);
  });

  it('mídia vira o tipo; texto vazio e sistema não viram prévia', () => {
    expect(messagePreviewOf('photo_temp', null)).toBe('📷 Foto temporária');
    expect(messagePreviewOf('audio', null)).toBe('🎤 Áudio');
    expect(messagePreviewOf('gif', null)).toBe('GIF');
    expect(messagePreviewOf('text', '   ')).toBeNull();
    expect(messagePreviewOf('system', 'Vocês se curtiram.')).toBeNull();
  });
});

describe('messagePushText', () => {
  const base = { peerName: 'Ana', preview: 'oi, tudo bem?', unread: 1 } as const;

  it.each([
    // [pasta, prévia ligada, não lidas, título, corpo]
    ['inbox', true, 1, 'Ana', 'oi, tudo bem?'],
    ['inbox', false, 1, 'Ana', 'Mandou uma mensagem'],
    ['inbox', false, 4, 'Ana', '4 mensagens novas'],
    ['requests', true, 1, 'Nova solicitação de mensagem', 'Ana: oi, tudo bem?'],
    ['requests', false, 3, 'Nova solicitação de mensagem', 'Ana quer conversar com você'],
  ] as const)(
    '%s, prévia %s, %d não lida(s) → "%s" / "%s"',
    (folder, showPreview, unread, title, body) => {
      expect(messagePushText({ ...base, folder, showPreview, unread })).toEqual({ title, body });
    },
  );

  it('prévia desligada nunca mostra o texto (nem no corpo, nem no título)', () => {
    for (const folder of ['inbox', 'requests'] as const) {
      const t = messagePushText({ ...base, folder, showPreview: false, preview: 'segredo' });
      expect(JSON.stringify(t)).not.toContain('segredo');
    }
  });

  it('sem prévia disponível (mídia desconhecida) cai no texto genérico; sem nome vira "Alguém"', () => {
    expect(messagePushText({ ...base, folder: 'inbox', showPreview: true, preview: null })).toEqual(
      {
        title: 'Ana',
        body: 'Mandou uma mensagem',
      },
    );
    expect(
      messagePushText({
        peerName: null,
        folder: 'requests',
        preview: null,
        showPreview: true,
        unread: 1,
      }),
    ).toEqual({ title: 'Nova solicitação de mensagem', body: 'Alguém quer conversar com você' });
  });
});

describe('likePushText (privacidade de quem curtiu)', () => {
  it.each([
    // [nome, soma, super, título, corpo]
    [null, 1, false, 'Alguém curtiu você 💚', 'Abre o Metch pra ver.'],
    [null, 5, false, 'Você tem 5 curtidas novas 💚', 'Abre o Metch pra ver.'],
    [null, 1, true, 'Alguém te mandou uma super curtida ⭐', 'Abre o Metch pra ver.'],
    ['Ana', 1, false, 'Ana curtiu você 💚', 'Curte de volta e dá Metch.'],
    ['Ana', 2, false, 'Ana e mais 1 pessoa curtiram você 💚', 'Curte de volta e dá Metch.'],
    ['Ana', 4, false, 'Ana e mais 3 pessoas curtiram você 💚', 'Curte de volta e dá Metch.'],
    ['Ana', 1, true, 'Ana te mandou uma super curtida ⭐', 'Curte de volta e dá Metch.'],
  ] as const)('nome %s, %d, super %s → "%s"', (likerName, count, isSuper, title, body) => {
    expect(likePushText({ likerName, count, isSuper })).toEqual({ title, body });
  });

  it('sem nome não há nome em lugar nenhum; contagem estranha vale 1', () => {
    const t = likePushText({ likerName: null, count: 0, isSuper: false });
    expect(t.title).toBe('Alguém curtiu você 💚');
    expect(likePushText({ likerName: null, count: Number.NaN, isSuper: false }).title).toBe(
      'Alguém curtiu você 💚',
    );
  });
});

describe('matchPushText', () => {
  it('METCH! com o nome de quem completou', () => {
    expect(matchPushText('Bia')).toEqual({
      title: 'METCH! 🔥',
      body: 'Você e Bia se curtiram. Manda um oi!',
    });
  });

  it('nome comprido é cortado', () => {
    const t = matchPushText('B'.repeat(80));
    expect(t.body.length).toBeLessThan(80);
    expect(t.body).toContain('…');
  });
});
