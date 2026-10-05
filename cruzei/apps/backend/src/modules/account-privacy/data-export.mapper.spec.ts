import {
  buildDataExport,
  exportableModerationAction,
  exportFileName,
  folderOf,
  supportAuthor,
  visibleModerationActions,
  type ExportRows,
} from './data-export.mapper';

// Cópia dos dados: o mapper é a última trava. Mesmo que o serviço traga uma linha a mais, nunca sai mensagem da outra
// ponta, mensagem de sistema, denúncia feita por outra pessoa, nota interna do suporte nem campo técnico das prefs.

const ME = '0a000000-0000-4000-8000-00000000000a';
const PEER = '0b000000-0000-4000-8000-00000000000b';
const CONV = '0c000000-0000-4000-8000-00000000000c';
const T = (s: string) => new Date(`2026-10-0${s}T12:00:00.000Z`);

function rows(over: Partial<ExportRows> = {}): ExportRows {
  return {
    user: {
      id: ME,
      phone: '+5534999990000',
      email: null,
      createdAt: T('1'),
      lastActiveAt: T('4'),
      role: 'user',
      accountStatus: 'active',
      suspendedUntil: null,
      moderationReason: null,
      termsVersion: '1.2',
      termsAcceptedAt: T('1'),
      orientationConsentedAt: null,
      name: 'Ana',
      birthDate: new Date('1995-03-10T00:00:00.000Z'),
      gender: 'female',
      orientation: null,
      showOrientation: false,
      sameOrientationFirst: false,
      bio: 'oi',
      instagramHandle: 'ana',
      lookingFor: 'friendship',
      avatarConfig: { hair: 1 },
      isVerified: false,
      profileCompleteness: 80,
      showMe: 'everyone',
      ageMin: 18,
      ageMax: 99,
      visibilityMode: 'visible',
      anonymousUntil: null,
      showDistance: true,
      showAge: true,
      showPhotoOnMap: true,
      discoveryMode: 'everyone',
      isPaused: false,
      pausedUntil: null,
      premiumTier: 'free',
      premiumExpiresAt: null,
      trialUsedAt: null,
    },
    interests: ['Música', 'Café'],
    seals: [],
    notificationPrefs: { userId: ME, messages: true, likes: false, updatedAt: T('2') },
    photos: [
      {
        url: 'p/aaa.jpg',
        thumbnailUrl: 'p/aaa-t.jpg',
        orderIndex: 0,
        isMain: true,
        status: 'approved',
        rejectReason: null,
        createdAt: T('1'),
      },
    ],
    privateAreas: [
      {
        label: 'Casa',
        radiusM: 200,
        latitude: '-18.918612',
        longitude: { toString: () => '-48.277201' },
        createdAt: T('1'),
      },
    ],
    presence: { lat: '-18.9186', lng: '-48.2772', updatedAt: T('4').getTime() },
    history: [
      {
        latitude: -18.919,
        longitude: -48.277,
        accuracyMeters: 12,
        city: 'Uberlândia',
        state: 'MG',
        recordedAt: T('3'),
      },
    ],
    checkins: [{ poiId: BigInt(42), checkinAt: T('3'), durationMinutes: 30 }],
    learnedHomeCells: [{ cell: '6upq8c', nights: 4 }],
    placeVotes: [{ candidateId: BigInt(7), kind: 'onsite', votedOn: T('3') }],
    placeReports: [],
    likesSent: [{ likedId: PEER, isSuper: true, createdAt: T('2') }],
    likesReceivedCount: 3,
    passes: [],
    visitsMade: [],
    visitsReceivedCount: 5,
    blocks: [],
    conversations: [
      {
        id: CONV,
        createdAt: T('2'),
        promotedAt: null,
        userLowId: ME,
        userHighId: PEER,
        me: { role: 'REQUESTER', archivedAt: null, isMuted: false },
      },
    ],
    myMessages: [
      {
        id: 'm2',
        conversationId: CONV,
        senderId: ME,
        messageType: 'text',
        systemKind: null,
        body: 'segunda',
        mediaUrl: null,
        lat: null,
        lng: null,
        createdAt: T('3'),
        readAt: null,
      },
      {
        id: 'm1',
        conversationId: CONV,
        senderId: ME,
        messageType: 'text',
        systemKind: null,
        body: 'primeira',
        mediaUrl: null,
        lat: null,
        lng: null,
        createdAt: T('2'),
        readAt: T('3'),
      },
      // vazaram do serviço: nunca podem sair
      {
        id: 'x1',
        conversationId: CONV,
        senderId: PEER,
        messageType: 'text',
        systemKind: null,
        body: 'da outra pessoa',
        mediaUrl: null,
        lat: null,
        lng: null,
        createdAt: T('2'),
        readAt: null,
      },
      {
        id: 'x2',
        conversationId: CONV,
        senderId: ME,
        messageType: 'system',
        systemKind: 'match',
        body: 'match!',
        mediaUrl: null,
        lat: null,
        lng: null,
        createdAt: T('2'),
        readAt: null,
      },
    ],
    reportsMade: [
      {
        reporterId: ME,
        reportedId: PEER,
        reason: 'spam',
        description: 'chato',
        status: 'pending',
        createdAt: T('3'),
      },
      {
        reporterId: PEER,
        reportedId: ME,
        reason: 'harassment',
        description: 'contra mim',
        status: 'pending',
        createdAt: T('3'),
      },
    ],
    moderationActions: [{ action: 'warn', createdAt: T('3') }],
    notifications: [],
    devices: [{ platform: 'android', appVersion: '1.0.0', createdAt: T('1'), lastUsedAt: T('4') }],
    subscriptions: [],
    boosts: [],
    superLikeUses: [{ day: T('3'), used: 1 }],
    support: [
      {
        id: 's1',
        status: 'open',
        urgent: false,
        createdAt: T('2'),
        messages: [
          { author: 'user', body: 'socorro', internal: false, createdAt: T('2') },
          { author: 'staff', body: 'nota interna', internal: true, createdAt: T('2') },
          { author: 'staff', body: 'oi, tudo bem?', internal: false, createdAt: T('3') },
        ],
      },
    ],
    analytics: [],
    accessLogs: [
      { event: 'login', ip: '203.0.113.9', port: 51000, userAgent: 'Metch/1.0', createdAt: T('4') },
    ],
    deletionRequests: [],
    ...over,
  };
}

describe('buildDataExport', () => {
  const out = buildDataExport(rows(), T('5'), (k) => `https://cdn.metch.app/${k}`);

  it('cabeçalho e formato', () => {
    expect(out).toMatchObject({
      format: 'metch-data-export',
      version: 1,
      generatedAt: T('5').toISOString(),
    });
    expect(out.notIncluded.length).toBeGreaterThan(3);
  });

  it('só as mensagens DA pessoa, sem sistema, em ordem', () => {
    const c = out.conversations[0];
    expect(c.myMessages.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(JSON.stringify(out)).not.toContain('da outra pessoa');
    expect(c.peerId).toBe(PEER);
    expect(c.folder).toBe('inbox');
  });

  it('só denúncias FEITAS pela pessoa', () => {
    expect(out.reportsMade).toHaveLength(1);
    expect(out.reportsMade[0]).toMatchObject({ reportedId: PEER, reason: 'spam' });
    expect(JSON.stringify(out)).not.toContain('contra mim');
  });

  it('suporte sem nota interna, autor do ponto de vista da pessoa', () => {
    expect(out.support[0].messages).toEqual([
      { author: 'me', body: 'socorro', createdAt: T('2').toISOString() },
      { author: 'team', body: 'oi, tudo bem?', createdAt: T('3').toISOString() },
    ]);
  });

  it('prefs só com os booleanos (sem user_id nem updated_at)', () => {
    expect(out.settings.notificationPrefs).toEqual({ messages: true, likes: false });
  });

  it('centro exato das áreas privadas, células da casa e presença com número', () => {
    expect(out.privateAreas[0]).toMatchObject({ label: 'Casa', lat: -18.918612, lng: -48.277201 });
    expect(out.location.learnedHomeCells).toEqual([{ cell: '6upq8c', nights: 4 }]);
    expect(out.location.currentPresence).toEqual({
      lat: -18.9186,
      lng: -48.2772,
      updatedAt: T('4').toISOString(),
    });
    expect(out.location.checkins[0].poiId).toBe('42');
    expect(out.location.placeVotes[0]).toEqual({
      candidateId: '7',
      kind: 'onsite',
      votedOn: '2026-10-03',
    });
  });

  it('foto com URL pública montada da chave', () => {
    expect(out.photos[0].url).toBe('https://cdn.metch.app/p/aaa.jpg');
    expect(out.photos[0].thumbnailUrl).toBe('https://cdn.metch.app/p/aaa-t.jpg');
  });

  it('nunca leva campos de credencial', () => {
    const s = JSON.stringify(out);
    for (const k of [
      'passwordHash',
      'password_hash',
      'sessionsValidAfter',
      'token',
      'verificationSelfie',
    ])
      expect(s).not.toContain(k);
  });

  it('BigInt não quebra o JSON', () => {
    expect(() => JSON.stringify(out)).not.toThrow();
  });

  it('sem presença: null', () => {
    expect(buildDataExport(rows({ presence: null }), T('5')).location.currentPresence).toBeNull();
  });

  it('moderação: só a lista BRANCA (sem retenção silenciosa, antifraude nem dispensa de denúncia)', () => {
    const all = [
      'warn',
      'suspend:7',
      'suspend:revisao',
      'ban',
      'reinstate',
      'photo_approve',
      'photo_reject',
      'phone_released',
      // registros internos: nunca saem
      'auto_hold',
      'auto_flag_gps',
      'dismiss',
      'photo_review',
      'hold',
    ].map((action) => ({ action, createdAt: T('3') }));
    const got = buildDataExport(rows({ moderationActions: all }), T('5')).moderation.actions;
    expect(got.map((a) => a.type)).toEqual([
      'warn',
      'suspend:7',
      'suspend:revisao',
      'ban',
      'reinstate',
      'photo_approve',
      'photo_reject',
      'phone_released',
    ]);
  });

  it('moderação: ação ligada a denúncia em análise não sai', () => {
    const R1 = '0d000000-0000-4000-8000-00000000000d';
    const R2 = '0e000000-0000-4000-8000-00000000000e';
    const out2 = buildDataExport(
      rows({
        moderationActions: [
          { action: 'warn', createdAt: T('2'), reportId: R1 },
          { action: 'ban', createdAt: T('3'), reportId: R2 },
        ],
        openReportIds: [R1.toUpperCase()],
      }),
      T('5'),
    );
    expect(out2.moderation.actions.map((a) => a.type)).toEqual(['ban']);
  });

  it('o "não vem" explica os registros internos de segurança', () => {
    expect(out.notIncluded.join(' ')).toMatch(/revisões automáticas/);
  });
});

describe('exportableModerationAction / visibleModerationActions', () => {
  it('suspend com prazo entra pelo prefixo; parecidos não', () => {
    expect(exportableModerationAction('suspend:30')).toBe(true);
    expect(exportableModerationAction('suspended')).toBe(false);
    expect(exportableModerationAction('auto_hold')).toBe(false);
    expect(exportableModerationAction('unban')).toBe(true);
  });

  it('sem denúncia em análise, a ação branca sai', () => {
    expect(visibleModerationActions([{ action: 'warn', reportId: 'x' }], [])).toHaveLength(1);
  });
});

describe('helpers', () => {
  it('folderOf segue a inbox', () => {
    expect(folderOf(T('1'), 'TARGET')).toBe('inbox');
    expect(folderOf(null, 'REQUESTER')).toBe('inbox');
    expect(folderOf(null, 'TARGET')).toBe('requests');
  });

  it('supportAuthor', () => {
    expect(supportAuthor('user')).toBe('me');
    expect(supportAuthor('staff')).toBe('team');
    expect(supportAuthor('system')).toBe('system');
  });

  it('exportFileName usa o dia de São Paulo', () => {
    expect(exportFileName('metch-meus-dados-', new Date('2026-10-06T01:30:00Z'))).toBe(
      'metch-meus-dados-2026-10-05.json',
    );
  });
});
