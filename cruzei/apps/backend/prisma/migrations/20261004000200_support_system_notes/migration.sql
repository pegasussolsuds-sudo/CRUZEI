-- Botão de emergência: o sistema grava uma NOTA INTERNA no atendimento urgente (nome e id da outra pessoa, conversa,
-- denúncia e bloqueio) — só a equipe vê, nunca vai pro app. A regra antiga (20261002000000_admin_panel) só aceitava
-- nota interna da equipe (author = 'staff'); agora a equipe OU o sistema.
-- Idempotente: derruba e recria o CHECK (a regra nova é mais larga, nenhuma linha antiga quebra).
-- Aplicar: docker exec -i cruzei-postgres psql -U cruzei -d cruzei -v ON_ERROR_STOP=1 < migration.sql
BEGIN;

ALTER TABLE support_messages DROP CONSTRAINT IF EXISTS support_messages_internal_chk;
ALTER TABLE support_messages
  ADD CONSTRAINT support_messages_internal_chk CHECK (NOT internal OR author IN ('staff', 'system'));

COMMIT;
