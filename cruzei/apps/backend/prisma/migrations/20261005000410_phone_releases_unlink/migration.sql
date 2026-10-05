-- Número reciclado × conta limpa (05/10/2026): nas linhas de phone_releases com new_user_id = conta limpa NÃO banida
-- (o número que veio PRA ela), o vínculo sai 6 meses depois da limpeza (AccountPurgeService.retention): new_user_id vira
-- NULL e new_user_unlinked_at marca quando. A linha continua sendo o histórico da conta ANTIGA (número inteiro fica se
-- ela foi banida: evasão de banimento), mas não aponta mais pra quem excluiu a conta. A marca impede que o cadastro
-- seguinte com o mesmo número pegue a linha de novo (PhoneReleaseService.pendingReleases só liga linha sem marca).
-- Até os 6 meses, a ficha da conta limpa já não mostra o número nas linhas 'incoming' (AdminUsersService).
-- Só aditiva e idempotente. Uma transação por arquivo (o executor abre e fecha). Aplicar ANTES do código novo.
-- Aplicar: pnpm --filter @cruzei/backend db:migrate (produção: db:migrate:prod), nunca migrate dev / db push.

-- quando o vínculo com a conta nova (limpa, não banida) foi desligado; null = nunca ligado ou ainda ligado
ALTER TABLE phone_releases ADD COLUMN IF NOT EXISTS new_user_unlinked_at TIMESTAMPTZ(6);
