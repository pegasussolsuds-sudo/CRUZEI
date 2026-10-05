-- Fotos (05/10/2026): photos.url e thumbnail_url passam a guardar a CHAVE do objeto; o servidor monta a URL na saída
-- (photoUrl() + STORAGE_PUBLIC_BASE_URL). Converte só o que ainda é URL /uploads/ do próprio backend; URL externa
-- (https://cdn/…) fica como está e o photoUrl() devolve igual. messages.media_url não muda (mídia do chat desligada).
-- ORDEM: aplicar DEPOIS do deploy do código que monta a URL. Antes disso o código antigo devolveria a chave crua e as
-- fotos quebram no app.
-- Idempotente (só pega o que ainda é URL), numa transação só. Caminho com '..' ou '//' fica como URL (nunca vira chave).
-- Aplicar: pnpm --filter @cruzei/backend db:migrate (produção: db:migrate:prod), nunca migrate dev / db push.
-- Depois: invalidar os perfis em cache no Redis (profile:*), que guardam o DTO com a URL antiga.

BEGIN;

UPDATE photos SET url = regexp_replace(url, '^https?://[^/]+/uploads/', '')
 WHERE url ~ '^https?://[^/]+/uploads/[A-Za-z0-9/_.-]+$' AND url !~ '/uploads/.*(\.\.|//)';

UPDATE photos SET thumbnail_url = regexp_replace(thumbnail_url, '^https?://[^/]+/uploads/', '')
 WHERE thumbnail_url ~ '^https?://[^/]+/uploads/[A-Za-z0-9/_.-]+$' AND thumbnail_url !~ '/uploads/.*(\.\.|//)';

COMMIT;
