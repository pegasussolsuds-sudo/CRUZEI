-- "Passar" salvo: antes da tabela passes (20261004000000) o passar só ia pro audit_log, e a pessoa voltava na próxima
-- recarga do deck. Traz os passes dos últimos 30 dias (DISCOVERY_PASS_DAYS padrão) do audit_log pra tabela passes,
-- pra quem já foi passado não voltar no deck depois da atualização. O audit_log é só-anexar: as linhas antigas ficam lá
-- como histórico (o app não grava mais passar nele).
-- Idempotente: ON CONFLICT DO NOTHING (um passar mais novo na tabela vence). Só alvo que existe e diferente de quem passou.
BEGIN;

INSERT INTO passes (user_id, target_id, created_at)
SELECT a.user_id, t.id, max(a.created_at) AT TIME ZONE 'UTC'
  FROM audit_log a
  JOIN users t ON t.id::text = a.metadata ->> 'target_id'
 WHERE a.action = 'pass'
   AND a.user_id IS NOT NULL
   AND a.user_id <> t.id
   -- audit_log.created_at é TIMESTAMP em UTC
   AND a.created_at > (now() AT TIME ZONE 'UTC') - interval '30 days'
 GROUP BY a.user_id, t.id
ON CONFLICT (user_id, target_id) DO NOTHING;

COMMIT;
