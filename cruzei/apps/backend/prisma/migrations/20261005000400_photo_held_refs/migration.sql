-- Fotos (05/10/2026): foto RETIDA por denúncia de menor/abuso infantil sai do endereço público, e a checagem de
-- referência do GC deixa de varrer selfie/capa/evidence_urls a cada kick.
--  · Retida: o arquivo é copiado pra held/<uuid NOVO>.<ext> (o /uploads recusa held/; no bucket o prefixo fica fora do
--    acesso público) e a linha de photos passa a apontar pra cópia. A cópia pública entra na fila com moved_to = chave
--    da cópia privada: o GC apaga essa mesmo com o dono em retenção (a prova já está em held/). A ficha da moderação lê
--    pela rota autenticada GET /v1/admin/photos/:id/file.
--  · media_objects.kind ganha 'held' (cópia privada; o anexo de upload exige kind 'photo', então nunca é reaproveitada).
--  · Gatilho photos_release_media aceita held/ (quando a retida sai, o arquivo privado entra na fila com a mesma regra
--    do 'urgent' = 180 dias).
--  · Referências fora de photos por igualdade: chave normalizada (chave crua e legado http(s)://<host>/uploads/<chave>
--    dão o mesmo valor) em índice de expressão; a URL da base atual usa os índices simples da 20261005000300;
--    evidence_urls (jsonb) por GIN em media_ref_keys(), que devolve cada item cru E normalizado.
--    As expressões TÊM que ser iguais às do código (MediaGcService.references; o spec confere).
-- Só ADITIVA e idempotente. Uma transação por arquivo (o executor abre e fecha). Aplicar ANTES do código novo.
-- Aplicar: pnpm --filter @cruzei/backend db:migrate (produção: db:migrate:prod), nunca migrate dev / db push.

-- ---------- cópia privada da foto retida ----------
-- cópia PÚBLICA de foto retida: chave da cópia privada (held/) que guarda a prova; null nas outras linhas
ALTER TABLE media_objects ADD COLUMN IF NOT EXISTS moved_to VARCHAR(200);

ALTER TABLE media_objects DROP CONSTRAINT IF EXISTS media_objects_kind_chk;
ALTER TABLE media_objects ADD CONSTRAINT media_objects_kind_chk CHECK (kind IN ('photo', 'held'));

-- foto apagada → chaves na fila; agora também held/ (a cópia privada não tem miniatura: thumb igual vira NULL)
CREATE OR REPLACE FUNCTION media_release_photo() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  k text := regexp_replace(OLD.url, '^https?://[^/]+/uploads/', '');
  t text := NULLIF(regexp_replace(COALESCE(OLD.thumbnail_url, ''), '^https?://[^/]+/uploads/', ''), '');
BEGIN
  IF k !~ '^(p/|held/)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,5}$' THEN
    RETURN OLD;
  END IF;
  IF t IS NOT NULL AND (t = k OR t !~ '^(p/)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-t\.jpg$') THEN
    t := NULL;
  END IF;
  INSERT INTO media_objects AS m (key, owner_id, kind, thumb_key, delete_after)
  VALUES (
    k, OLD.user_id, CASE WHEN k LIKE 'held/%' THEN 'held' ELSE 'photo' END, t,
    now() + CASE WHEN COALESCE(OLD.moderation_labels->>'urgent', '') = 'true' THEN interval '180 days' ELSE interval '0' END
  )
  ON CONFLICT (key) DO UPDATE SET
    thumb_key = COALESCE(m.thumb_key, EXCLUDED.thumb_key),
    attached_at = NULL,
    delete_after = GREATEST(COALESCE(m.delete_after, EXCLUDED.delete_after), EXCLUDED.delete_after);
  RETURN OLD;
END $$;

-- ---------- referências fora de photos (MediaGcService.references) ----------
CREATE INDEX IF NOT EXISTS users_selfie_key_norm_idx
  ON users ((regexp_replace(verification_selfie_url, '^https?://[^/]+/uploads/', '')))
  WHERE verification_selfie_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_cover_key_norm_idx
  ON events ((regexp_replace(cover_url, '^https?://[^/]+/uploads/', '')))
  WHERE cover_url IS NOT NULL;

-- itens de evidence_urls, crus e normalizados (chave, URL da base atual e legado batem por igualdade de elemento)
CREATE OR REPLACE FUNCTION media_ref_keys(j jsonb) RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(array_agg(DISTINCT z.y), '{}'::text[])
    FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(j) = 'array' THEN j ELSE '[]'::jsonb END) AS x(v)
   CROSS JOIN LATERAL (VALUES (x.v), (regexp_replace(x.v, '^https?://[^/]+/uploads/', ''))) AS z(y)
   WHERE z.y IS NOT NULL
$$;

CREATE INDEX IF NOT EXISTS reports_evidence_keys_idx
  ON reports USING gin (media_ref_keys(evidence_urls))
  WHERE evidence_urls IS NOT NULL;
