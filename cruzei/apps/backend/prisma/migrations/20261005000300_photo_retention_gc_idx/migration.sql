-- Fotos (05/10/2026): índices pro GC de arquivos (MediaGcService.references) e pra foto retida por denúncia.
-- Antes a checagem de referência varria photos/users/reports inteiras a cada foto apagada (kick). Agora:
--  · photos: índice na CHAVE normalizada — a chave crua e o legado http(s)://<qualquer host>/uploads/<chave> dão o mesmo
--    valor, então a consulta por igualdade (= ANY(chaves)) acha os dois sem varrer a tabela;
--  · selfie de verificação, capa de evento e evidence_urls de denúncia: parciais só nas poucas linhas preenchidas;
--  · foto retida (moderation_labels.retainedByReport, photo-retention.ts): a varredura que solta a foto quando a
--    denúncia fecha acha pelo parcial.
-- A expressão TEM que ser igual à do código (media-gc.service.ts), senão o índice não é usado (o spec confere).
-- Só ADITIVA e idempotente. Uma transação por arquivo (o executor abre e fecha).

CREATE INDEX IF NOT EXISTS photos_url_key_norm_idx
  ON photos ((regexp_replace(url, '^https?://[^/]+/uploads/', '')));
CREATE INDEX IF NOT EXISTS photos_thumb_key_norm_idx
  ON photos ((regexp_replace(thumbnail_url, '^https?://[^/]+/uploads/', '')))
  WHERE thumbnail_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_verification_selfie_url_idx
  ON users (verification_selfie_url) WHERE verification_selfie_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_cover_url_idx
  ON events (cover_url) WHERE cover_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS reports_evidence_urls_idx
  ON reports (id) WHERE evidence_urls IS NOT NULL;

CREATE INDEX IF NOT EXISTS photos_retained_idx
  ON photos (user_id) WHERE (moderation_labels -> 'retainedByReport') IS NOT NULL;
