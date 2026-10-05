import { parseFlag, privacyConfig } from './privacy-config';

describe('privacyConfig', () => {
  it('padrões da decisão (30 dias, 180 dias de prova, 5 anos, 3 cópias/dia, 3 limpezas/dia)', () => {
    expect(privacyConfig({})).toEqual({
      graceDays: 30,
      evidenceDays: 180,
      paymentYears: 5,
      exportDaily: 3,
      forgetDaily: 3,
    });
  });

  it('valor válido do ambiente vale', () => {
    const c = privacyConfig({
      ACCOUNT_DELETION_GRACE_DAYS: '0',
      DATA_EXPORT_DAILY_LIMIT: '10',
      ACCOUNT_EVIDENCE_RETENTION_DAYS: '365',
    });
    expect(c.graceDays).toBe(0);
    expect(c.exportDaily).toBe(10);
    expect(c.evidenceDays).toBe(365);
  });

  it('valor inválido cai no padrão seguro', () => {
    const c = privacyConfig({
      ACCOUNT_DELETION_GRACE_DAYS: '-1',
      DATA_EXPORT_DAILY_LIMIT: 'muitos',
      PAYMENT_RECORDS_RETENTION_YEARS: '2.5',
      ACCOUNT_EVIDENCE_RETENTION_DAYS: '0',
      LOCATION_FORGET_DAILY_LIMIT: ' ',
    });
    expect(c).toEqual({
      graceDays: 30,
      evidenceDays: 180,
      paymentYears: 5,
      exportDaily: 3,
      forgetDaily: 3,
    });
  });
});

describe('parseFlag (learnedHome)', () => {
  it('só true/1 liga', () => {
    expect(parseFlag('true')).toBe(true);
    expect(parseFlag('1')).toBe(true);
    expect(parseFlag(true)).toBe(true);
    expect(parseFlag('false')).toBe(false);
    expect(parseFlag(undefined)).toBe(false);
    expect(parseFlag('yes')).toBe(false);
  });
});
