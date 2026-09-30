import { EMERGENCY_PHONE } from '@cruzei/shared-types';

import { REPORT_PRIORITY } from '../reports/reports.service';

import { EMERGENCY_REPORT_TARGETS_PER_DAY } from './emergency-limits';
import {
  EMERGENCY_REPORT_PRIORITY,
  emergencyReplyText,
  emergencyStaffNote,
  emergencyThrottledText,
  emergencyUserText,
  shortDateBR,
} from './emergency-texts';

// Textos do botão de emergência: o nome da outra pessoa só na nota interna; nunca localização; sempre o 190.

const until = new Date('2026-10-07T15:00:00Z');
const target = { id: '0f5c3a4e-1111-4222-8333-444455556666', name: 'Fulano' };

describe('textos da emergência', () => {
  it('mensagem automática da pessoa: URGENTE e de onde veio, sem nome de ninguém', () => {
    expect(emergencyUserText('chat')).toMatch(/^🆘 URGENTE/);
    expect(emergencyUserText('chat')).toContain('numa conversa');
    expect(emergencyUserText('profile')).toContain('no perfil de uma pessoa');
    expect(emergencyUserText('help')).toContain('no app');
  });

  it('resposta do sistema: o que foi feito + ligar 190', () => {
    const t = emergencyReplyText({ pausedUntil: until, blocked: true, reported: true });
    expect(t).toContain('pausado até 07/10');
    expect(t).toContain('a pessoa foi bloqueada');
    expect(t).toContain('denúncia de segurança');
    expect(t).toContain(`ligue ${EMERGENCY_PHONE}`);
    const alone = emergencyReplyText({ pausedUntil: until, blocked: false, reported: false });
    expect(alone).not.toContain('bloqueada');
    expect(alone).not.toContain('denúncia');
  });

  it('nota interna: pessoa, conversa, denúncia e bloqueio; nada de localização', () => {
    const note = emergencyStaffNote({
      via: 'chat',
      target,
      conversationId: 'c-1',
      reportId: 'r-1',
      blocked: false,
      blockFailed: true,
      pausedUntil: until,
    });
    expect(note).toContain('Fulano');
    expect(note).toContain(target.id);
    expect(note).toContain('c-1');
    expect(note).toContain('r-1');
    expect(note).toContain('NÃO deu');
    expect(note).toContain('Localização não é enviada');
    expect(note).not.toMatch(/lat|lng|longitude|latitude/i);
    const none = emergencyStaffNote({
      via: 'help',
      target: null,
      conversationId: null,
      reportId: null,
      blocked: false,
      blockFailed: false,
      pausedUntil: until,
    });
    expect(none).toContain('Sem pessoa envolvida');
    expect(none).not.toContain('Bloqueio');
  });

  it('nota interna: pessoa citada sem relação e denúncia fora do orçamento', () => {
    const base = {
      conversationId: null,
      reportId: null,
      blocked: false,
      blockFailed: false,
      pausedUntil: until,
    };
    const unrelated = emergencyStaffNote({
      ...base,
      via: 'profile',
      target: null,
      unrelated: target,
    });
    expect(unrelated).toContain('SEM relação registrada');
    expect(unrelated).toContain(target.id);
    expect(unrelated).toContain('Não foi bloqueada nem denunciada');
    expect(unrelated).not.toContain('Sem pessoa envolvida');
    expect(unrelated).not.toContain('Bloqueio:');

    const hour = emergencyStaffNote({
      ...base,
      via: 'chat',
      target,
      blocked: true,
      reportSkipped: 'hour',
    });
    expect(hour).toContain('Denúncia NÃO criada: limite de denúncias da última hora');
    const targets = emergencyStaffNote({ ...base, via: 'chat', target, reportSkipped: 'targets' });
    expect(targets).toContain(
      `já denunciou ${EMERGENCY_REPORT_TARGETS_PER_DAY} pessoas diferentes`,
    );
    // sem pessoa não fala de denúncia
    const none = emergencyStaffNote({ ...base, via: 'help', target: null, reportSkipped: 'hour' });
    expect(none).not.toContain('Denúncia');
  });

  it('429 do botão: equipe já avisada + ligue 190', () => {
    expect(emergencyThrottledText()).toContain('se um dos acionamentos deu certo');
    // o 190 vem antes de qualquer coisa: a tentativa anterior pode ter falhado
    expect(emergencyThrottledText().indexOf('190')).toBeLessThan(emergencyThrottledText().indexOf('Equipe Metch'));
    expect(emergencyThrottledText()).toContain(`ligue ${EMERGENCY_PHONE}`);
  });

  it('prioridade acima de qualquer motivo do app', () => {
    expect(EMERGENCY_REPORT_PRIORITY).toBeGreaterThan(Math.max(...Object.values(REPORT_PRIORITY)));
  });

  it('data no fuso de São Paulo', () => {
    // 02:00 UTC do dia 8 ainda é dia 7 em São Paulo
    expect(shortDateBR(new Date('2026-10-08T02:00:00Z'))).toBe('07/10');
  });
});
