-- Descoberta de lugares pela galera (28/09/2026).
-- Idempotente. Aplicar com: docker exec -i cruzei-postgres psql -U cruzei -d cruzei < migration.sql
-- (nunca migrate dev / db push: o banco não tem _prisma_migrations)
--
-- place_candidates: só dado PÚBLICO de lugar (Mapbox) — nome, ponto, categoria, a célula geohash-7 do PRÓPRIO lugar.
-- Nada de usuário aqui. Um candidato só vira `pois` quando passa nas regras; enquanto isso nenhum leitor de POI o vê.
CREATE TABLE IF NOT EXISTS place_candidates (
  id BIGSERIAL PRIMARY KEY,
  key VARCHAR(120) NOT NULL UNIQUE,                 -- 'mbx:<mapbox_id>'
  mapbox_id VARCHAR(100) NOT NULL,
  cell VARCHAR(8) NOT NULL,                         -- geohash-7 do LUGAR (público), nunca de pessoa
  status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'promoted', 'rejected', 'expired')),
  name VARCHAR(255) NOT NULL,
  category "POICategory" NOT NULL,
  kind VARCHAR(20) NOT NULL,
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  address VARCHAR(500),
  neighborhood VARCHAR(100),
  city VARCHAR(100),
  state CHAR(2),
  ambiguous BOOLEAN NOT NULL DEFAULT false,         -- dois lugares dividem a multidão: pergunta pra quem está lá em vez de publicar sozinho
  crowd_pass_on DATE,                               -- último dia em que a regra da multidão passou (só o dia)
  last_evidence_on DATE NOT NULL,
  resolved_on DATE,
  poi_id BIGINT REFERENCES pois(id) ON DELETE SET NULL,
  created_on DATE NOT NULL
);
CREATE INDEX IF NOT EXISTS place_candidates_status_cell_idx ON place_candidates(status, cell);

-- votos: privados, com granularidade de DIA, podados (on-site vira pedido depois de 3 dias; negações somem em 3 dias)
CREATE TABLE IF NOT EXISTS place_votes (
  candidate_id BIGINT NOT NULL REFERENCES place_candidates(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind VARCHAR(8) NOT NULL CHECK (kind IN ('request', 'onsite', 'deny')),
  voted_on DATE NOT NULL,
  PRIMARY KEY (candidate_id, user_id)
);
CREATE INDEX IF NOT EXISTS place_votes_voted_on_idx ON place_votes(voted_on);

-- denúncias de lugares descobertos (30 dias)
CREATE TABLE IF NOT EXISTS poi_reports (
  poi_id BIGINT NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason VARCHAR(16) NOT NULL CHECK (reason IN ('not_public', 'residence', 'closed', 'wrong_place', 'offensive')),
  reported_on DATE NOT NULL,
  PRIMARY KEY (poi_id, user_id)
);
