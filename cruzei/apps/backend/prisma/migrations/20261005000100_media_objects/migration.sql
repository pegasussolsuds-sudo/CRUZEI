-- Fotos (05/10/2026): fila media_objects pra apagar o ARQUIVO (disco local ou S3/R2) quando a foto sai.
-- Cada upload vira uma linha (dono = quem subiu; delete_after = expira em 24 h se não for anexado). Um gatilho AFTER
-- DELETE em photos põe as chaves na fila por qualquer caminho (DELETE /me/photos, limpeza da conta, cascade, script);
-- o GC (MediaGcService) apaga no storage com checagem de referência, lease e retenção legal.
-- Retenção: foto com rótulo 'urgent' da moderação (possível menor) só sai depois de 180 dias; conta com denúncia
-- underage/child_safety aberta é adiada pelo GC; o resto sai na hora.
-- Compatível com o código antigo: o gatilho normaliza a URL absoluta legada (http(s)://host/uploads/<chave>) pra chave.
-- fakes/ do seed e URL externa nunca entram na fila.
-- ORDEM: aplicar ANTES do deploy do código novo de fotos; a 20261005000200_photo_keys vem DEPOIS do deploy.
-- Só ADITIVA e idempotente, numa transação só.
-- Aplicar: docker exec -i cruzei-postgres psql -U cruzei -d cruzei -v ON_ERROR_STOP=1 < migration.sql
-- (nunca migrate dev / db push: o banco não tem _prisma_migrations)

BEGIN;

CREATE TABLE IF NOT EXISTS media_objects (
  -- chave do objeto no storage (p/<uuid>.jpg; legado <uuid>.<ext> na raiz)
  key VARCHAR(200) PRIMARY KEY,
  -- quem subiu; sem FK: sobrevive à limpeza da conta, que é justamente quando o arquivo tem que sair
  owner_id UUID,
  kind VARCHAR(16) NOT NULL DEFAULT 'photo',
  -- miniatura que sai junto (p/<uuid>-t.jpg)
  thumb_key VARCHAR(200),
  bytes INTEGER,
  width SMALLINT,
  height SMALLINT,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  -- anexado a uma foto (POST /me/photos); null = upload ainda solto
  attached_at TIMESTAMPTZ(6),
  -- quando pode apagar do storage; null = em uso
  delete_after TIMESTAMPTZ(6),
  delete_attempts SMALLINT NOT NULL DEFAULT 0,
  last_error VARCHAR(200),
  CONSTRAINT media_objects_kind_chk CHECK (kind IN ('photo'))
);
CREATE INDEX IF NOT EXISTS media_objects_delete_idx ON media_objects (delete_after) WHERE delete_after IS NOT NULL;
CREATE INDEX IF NOT EXISTS media_objects_owner_idx ON media_objects (owner_id);

-- checagem de referência do GC e busca por chave
CREATE INDEX IF NOT EXISTS photos_url_idx ON photos (url);
CREATE INDEX IF NOT EXISTS photos_thumbnail_url_idx ON photos (thumbnail_url);
-- uma linha de photos por objeto novo (anexar é idempotente)
CREATE UNIQUE INDEX IF NOT EXISTS photos_url_key_uq ON photos (url) WHERE url LIKE 'p/%';

-- foto apagada → chaves na fila (thumb igual ao original vira NULL, então o INSERT nunca bate duas vezes na mesma linha)
CREATE OR REPLACE FUNCTION media_release_photo() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  k text := regexp_replace(OLD.url, '^https?://[^/]+/uploads/', '');
  t text := NULLIF(regexp_replace(COALESCE(OLD.thumbnail_url, ''), '^https?://[^/]+/uploads/', ''), '');
BEGIN
  IF k !~ '^(p/)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,5}$' THEN
    RETURN OLD;
  END IF;
  IF t IS NOT NULL AND (t = k OR t !~ '^(p/)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-t\.jpg$') THEN
    t := NULL;
  END IF;
  INSERT INTO media_objects AS m (key, owner_id, kind, thumb_key, delete_after)
  VALUES (
    k, OLD.user_id, 'photo', t,
    now() + CASE WHEN COALESCE(OLD.moderation_labels->>'urgent', '') = 'true' THEN interval '180 days' ELSE interval '0' END
  )
  ON CONFLICT (key) DO UPDATE SET
    thumb_key = COALESCE(m.thumb_key, EXCLUDED.thumb_key),
    attached_at = NULL,
    delete_after = GREATEST(COALESCE(m.delete_after, EXCLUDED.delete_after), EXCLUDED.delete_after);
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS photos_release_media ON photos;
CREATE TRIGGER photos_release_media
  AFTER DELETE ON photos
  FOR EACH ROW EXECUTE FUNCTION media_release_photo();

COMMIT;
