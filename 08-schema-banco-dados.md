# 08 — Schema do Banco de Dados

> PostgreSQL + Redis.
> Tabelas, índices, views, functions e estrutura de presença real-time.

---

## 🐘 PostgreSQL

### Visão geral
- **Versão:** 15+
- **Extensões:** uuid-ossp, postgis, pg_trgm, btree_gist
- **Encoding:** UTF8
- **Estratégia:** soft delete em dados sensíveis, audit log em ações críticas

### Diagrama de relacionamentos (resumido)

```
users ──┬── photos (1:N)
        ├── user_interests (N:N)
        ├── locations (1:N)
        ├── pois_checkins (1:N)
        ├── likes (N:N — likes)
        ├── matches (N:N — matches)
        ├── messages (via matches)
        ├── visits (N:N)
        ├── seals (1:N)
        ├── blocks (N:N)
        ├── reports (N:N)
        ├── subscriptions (1:N)
        ├── boosts (1:N)
        ├── notifications (1:N)
        ├── device_tokens (1:N)
        └── audit_log (1:N)

pois ──── pois_checkins (1:N)
       ──── matches (1:N via poi_id)
       ──── locations (N:1)
```

---

## 📋 Schema SQL Completo

Arquivo: `apps/backend/src/database/migrations/001_initial_schema.sql`

```sql
-- ============================================
-- CRUZEI - Schema Inicial
-- Banco: PostgreSQL 15+
-- Data: Outubro 2025
-- ============================================

-- Extensões
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- ============================================
-- ENUMS
-- ============================================

CREATE TYPE gender_type AS ENUM (
    'female', 'male', 'non_binary', 'other'
);

CREATE TYPE orientation_type AS ENUM (
    'heterosexual', 'homosexual', 'bisexual', 'pansexual', 'other'
);

CREATE TYPE looking_for_type AS ENUM (
    'relationship', 'casual', 'friendship', 'network', 'unspecified'
);

CREATE TYPE premium_tier AS ENUM (
    'free', 'premium', 'premium_plus'
);

CREATE TYPE visibility_mode AS ENUM (
    'visible', 'anonymous'
);

CREATE TYPE match_status AS ENUM (
    'active', 'expired', 'unmatched', 'blocked'
);

CREATE TYPE message_type AS ENUM (
    'text', 'photo_temp', 'audio', 'location', 'gif', 'system'
);

CREATE TYPE photo_source AS ENUM (
    'user_upload', 'facebook', 'instagram'
);

CREATE TYPE seal_type AS ENUM (
    'cafeteria', 'praieiro', 'roadie', 'boemio',
    'natureza', 'urbanista', 'fitness', 'cultural'
);

CREATE TYPE report_status AS ENUM (
    'pending', 'reviewing', 'resolved', 'dismissed'
);

CREATE TYPE poi_category AS ENUM (
    'bar', 'restaurant', 'cafe', 'park', 'shopping',
    'gym', 'show', 'event', 'beach', 'museum', 'other'
);

-- ============================================
-- TABELA: users
-- ============================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone VARCHAR(20) UNIQUE,
    email VARCHAR(255) UNIQUE,
    password_hash VARCHAR(255),

    name VARCHAR(50) NOT NULL,
    birth_date DATE NOT NULL,
    gender gender_type NOT NULL,
    orientation orientation_type,
    looking_for looking_for_type DEFAULT 'unspecified',
    bio TEXT CHECK (LENGTH(bio) <= 300),

    premium_tier premium_tier DEFAULT 'free',
    premium_expires_at TIMESTAMP,

    visibility_mode visibility_mode DEFAULT 'anonymous',
    is_paused BOOLEAN DEFAULT false,
    paused_until TIMESTAMP,
    show_distance BOOLEAN DEFAULT true,
    show_age BOOLEAN DEFAULT true,

    is_verified BOOLEAN DEFAULT false,
    verified_at TIMESTAMP,
    verification_selfie_url VARCHAR(500),

    profile_completeness SMALLINT DEFAULT 0 CHECK (profile_completeness BETWEEN 0 AND 100),

    data_retention_until DATE,
    deleted_at TIMESTAMP,

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    last_active_at TIMESTAMP DEFAULT NOW(),

    CONSTRAINT age_valid CHECK (
        birth_date <= CURRENT_DATE - INTERVAL '18 years'
    )
);

CREATE INDEX idx_users_phone ON users(phone) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_email ON users(email) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_premium ON users(premium_tier) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_active ON users(last_active_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_name_trgm ON users USING gin (name gin_trgm_ops);

COMMENT ON TABLE users IS 'Perfis principais dos usuários';

-- ============================================
-- TABELA: photos
-- ============================================

CREATE TABLE photos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url VARCHAR(500) NOT NULL,
    thumbnail_url VARCHAR(500),
    order_index SMALLINT NOT NULL DEFAULT 0,
    is_main BOOLEAN DEFAULT false,
    source photo_source DEFAULT 'user_upload',
    is_face_verified BOOLEAN DEFAULT false,

    created_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(user_id, order_index)
);

CREATE INDEX idx_photos_user ON photos(user_id, order_index);

-- ============================================
-- TABELA: interests (catálogo)
-- ============================================

CREATE TABLE interests (
    id SMALLSERIAL PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL,
    icon VARCHAR(50),
    category VARCHAR(50)
);

-- ============================================
-- TABELA: user_interests (N:N)
-- ============================================

CREATE TABLE user_interests (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    interest_id SMALLINT REFERENCES interests(id) ON DELETE CASCADE,

    PRIMARY KEY (user_id, interest_id)
);

CREATE INDEX idx_user_interests_user ON user_interests(user_id);

-- ============================================
-- TABELA: locations (presença em tempo real)
-- ============================================

CREATE TABLE locations (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    location GEOGRAPHY(POINT, 4326) NOT NULL,
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    geohash VARCHAR(12) NOT NULL,
    accuracy_meters SMALLINT,

    poi_id BIGINT,
    city VARCHAR(100),
    state CHAR(2),

    recorded_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '5 hours',

    is_anonymous BOOLEAN DEFAULT false
);

CREATE INDEX idx_locations_user_time ON locations(user_id, recorded_at DESC);
CREATE INDEX idx_location_geo ON locations USING GIST (location);
CREATE INDEX idx_locations_geohash ON locations(geohash);
CREATE INDEX idx_locations_expires ON locations(expires_at);
CREATE INDEX idx_locations_city ON locations(city);

COMMENT ON TABLE locations IS 'Presença em tempo real (TTL 5h, retenção 30 dias)';

-- ============================================
-- TABELA: pois (pontos de interesse)
-- ============================================

CREATE TABLE pois (
    id BIGSERIAL PRIMARY KEY,
    external_id VARCHAR(100),

    name VARCHAR(255) NOT NULL,
    category poi_category NOT NULL,
    subcategory VARCHAR(50),

    location GEOGRAPHY(POINT, 4326) NOT NULL,
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,

    address VARCHAR(500),
    city VARCHAR(100),
    state CHAR(2),
    neighborhood VARCHAR(100),

    rating DECIMAL(2, 1),
    total_ratings INTEGER DEFAULT 0,
    phone VARCHAR(30),
    website VARCHAR(500),
    hours JSONB,
    photos JSONB,

    is_partner BOOLEAN DEFAULT false,
    partner_offer TEXT,

    source VARCHAR(20) DEFAULT 'osm',

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    last_verified_at TIMESTAMP,

    UNIQUE(source, external_id)
);

CREATE INDEX idx_pois_location ON pois USING GIST (location);
CREATE INDEX idx_pois_category ON pois(category);
CREATE INDEX idx_pois_city ON pois(city, category);
CREATE INDEX idx_pois_partner ON pois(is_partner) WHERE is_partner = true;
CREATE INDEX idx_pois_name_trgm ON pois USING gin (name gin_trgm_ops);

-- ============================================
-- TABELA: pois_checkins (histórico)
-- ============================================

CREATE TABLE pois_checkins (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    poi_id BIGINT NOT NULL REFERENCES pois(id) ON DELETE CASCADE,

    checkin_at TIMESTAMP DEFAULT NOW(),
    duration_minutes INTEGER
);

CREATE INDEX idx_checkins_user ON pois_checkins(user_id, checkin_at DESC);
CREATE INDEX idx_checkins_poi ON pois_checkins(poi_id, checkin_at DESC);

-- ============================================
-- TABELA: likes
-- ============================================

CREATE TABLE likes (
    id BIGSERIAL PRIMARY KEY,
    liker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    liked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    is_super BOOLEAN DEFAULT false,
    location_id BIGINT REFERENCES locations(id),

    created_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(liker_id, liked_id),
    CHECK (liker_id != liked_id)
);

CREATE INDEX idx_likes_liker ON likes(liker_id, created_at DESC);
CREATE INDEX idx_likes_liked ON likes(liked_id, created_at DESC);
CREATE INDEX idx_likes_super ON likes(liked_id, is_super) WHERE is_super = true;

-- ============================================
-- TABELA: matches
-- ============================================

CREATE TABLE matches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_a_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    location_id BIGINT REFERENCES locations(id),
    poi_id BIGINT REFERENCES pois(id),
    context_text VARCHAR(255),

    status match_status DEFAULT 'active',

    chat_expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '48 hours',
    last_renewed_at TIMESTAMP DEFAULT NOW(),

    matched_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(user_a_id, user_b_id),
    CHECK (user_a_id < user_b_id)
);

CREATE INDEX idx_matches_user_a ON matches(user_a_id, matched_at DESC);
CREATE INDEX idx_matches_user_b ON matches(user_b_id, matched_at DESC);
CREATE INDEX idx_matches_active ON matches(status) WHERE status = 'active';
CREATE INDEX idx_matches_expiring ON matches(chat_expires_at)
    WHERE status = 'active';

-- ============================================
-- TABELA: messages
-- ============================================

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    content TEXT,
    message_type message_type DEFAULT 'text',

    media_url VARCHAR(500),
    media_expires_at TIMESTAMP,

    location GEOGRAPHY(POINT, 4326),

    read_at TIMESTAMP,

    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP,

    CHECK (
        (message_type = 'text' AND content IS NOT NULL) OR
        (message_type IN ('photo_temp', 'audio', 'gif') AND media_url IS NOT NULL) OR
        (message_type = 'location' AND location IS NOT NULL) OR
        (message_type = 'system')
    )
);

CREATE INDEX idx_messages_match ON messages(match_id, created_at DESC);
CREATE INDEX idx_messages_sender ON messages(sender_id);
CREATE INDEX idx_messages_unread ON messages(match_id) WHERE read_at IS NULL;

-- ============================================
-- TABELA: visits (quem visitou quem)
-- ============================================

CREATE TABLE visits (
    id BIGSERIAL PRIMARY KEY,
    visitor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    visited_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    was_anonymous BOOLEAN DEFAULT false,
    visited_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(visitor_id, visited_id, visited_at)
);

CREATE INDEX idx_visits_visitor ON visits(visitor_id, visited_at DESC);
CREATE INDEX idx_visits_visited ON visits(visited_id, visited_at DESC);

-- ============================================
-- TABELA: seals (conquistas)
-- ============================================

CREATE TABLE seals (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seal_type seal_type NOT NULL,

    progress INTEGER DEFAULT 1,
    target INTEGER DEFAULT 5,
    is_completed BOOLEAN DEFAULT false,

    earned_at TIMESTAMP,
    updated_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(user_id, seal_type)
);

CREATE INDEX idx_seals_user ON seals(user_id);
CREATE INDEX idx_seals_completed ON seals(user_id) WHERE is_completed = true;

-- ============================================
-- TABELA: blocks
-- ============================================

CREATE TABLE blocks (
    id BIGSERIAL PRIMARY KEY,
    blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason VARCHAR(255),

    created_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(blocker_id, blocked_id),
    CHECK (blocker_id != blocked_id)
);

CREATE INDEX idx_blocks_blocker ON blocks(blocker_id);
CREATE INDEX idx_blocks_blocked ON blocks(blocked_id);

-- ============================================
-- TABELA: reports (denúncias)
-- ============================================

CREATE TABLE reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    reported_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    reason VARCHAR(50) NOT NULL,
    description TEXT,
    evidence_urls JSONB,

    status report_status DEFAULT 'pending',
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMP,
    action_taken VARCHAR(255),

    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_reports_pending ON reports(created_at) WHERE status = 'pending';
CREATE INDEX idx_reports_reported ON reports(reported_id);

-- ============================================
-- TABELA: subscriptions (pagamento)
-- ============================================

CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    tier premium_tier NOT NULL,
    platform VARCHAR(20) NOT NULL,

    original_transaction_id VARCHAR(255),
    product_id VARCHAR(100),

    starts_at TIMESTAMP NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    cancelled_at TIMESTAMP,

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_user ON subscriptions(user_id, expires_at DESC);
CREATE INDEX idx_subscriptions_active ON subscriptions(user_id, expires_at)
    WHERE cancelled_at IS NULL;

-- ============================================
-- TABELA: boosts
-- ============================================

CREATE TABLE boosts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    started_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL,
    location GEOGRAPHY(POINT, 4326),
    visibility_radius_meters INTEGER DEFAULT 5000,

    amount_cents INTEGER NOT NULL,
    platform VARCHAR(20) NOT NULL,
    transaction_id VARCHAR(255)
);

CREATE INDEX idx_boosts_active ON boosts(expires_at) WHERE expires_at > NOW();

-- ============================================
-- TABELA: notifications
-- ============================================

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    body TEXT,
    data JSONB,

    read_at TIMESTAMP,
    sent_at TIMESTAMP DEFAULT NOW(),

    delivery_status VARCHAR(20) DEFAULT 'pending',
    retry_count SMALLINT DEFAULT 0
);

CREATE INDEX idx_notifications_user ON notifications(user_id, sent_at DESC);
CREATE INDEX idx_notifications_unread ON notifications(user_id) WHERE read_at IS NULL;

-- ============================================
-- TABELA: audit_log (LGPD)
-- ============================================

CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    metadata JSONB,
    ip_address INET,
    user_agent TEXT,

    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_audit_user ON audit_log(user_id, created_at DESC);
CREATE INDEX idx_audit_action ON audit_log(action, created_at DESC);

-- ============================================
-- TABELA: device_tokens
-- ============================================

CREATE TABLE device_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    token VARCHAR(500) NOT NULL,
    platform VARCHAR(20) NOT NULL,
    app_version VARCHAR(20),

    created_at TIMESTAMP DEFAULT NOW(),
    last_used_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(platform, token)
);

CREATE INDEX idx_device_tokens_user ON device_tokens(user_id);

-- ============================================
-- TABELA: data_deletion_requests (LGPD)
-- ============================================

CREATE TABLE data_deletion_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    requested_at TIMESTAMP DEFAULT NOW(),
    scheduled_for TIMESTAMP NOT NULL,
    completed_at TIMESTAMP,

    status VARCHAR(20) DEFAULT 'pending'
);

-- ============================================
-- VIEWS
-- ============================================

-- View: usuários ativos nas últimas 5h
CREATE OR REPLACE VIEW active_users_5h AS
SELECT
    u.id,
    u.name,
    u.birth_date,
    u.gender,
    u.premium_tier,
    u.visibility_mode,
    l.latitude,
    l.longitude,
    l.geohash,
    l.poi_id,
    l.recorded_at
FROM users u
INNER JOIN locations l ON l.user_id = u.id
WHERE
    u.deleted_at IS NULL
    AND u.is_paused = false
    AND u.visibility_mode = 'visible'
    AND l.expires_at > NOW()
    AND l.recorded_at > NOW() - INTERVAL '5 hours';

-- View: matches com contexto
CREATE OR REPLACE VIEW matches_with_context AS
SELECT
    m.*,
    p.name AS poi_name,
    p.category AS poi_category
FROM matches m
LEFT JOIN pois p ON p.id = m.poi_id
WHERE m.status = 'active';

-- ============================================
-- FUNCTIONS
-- ============================================

-- Calcular idade
CREATE OR REPLACE FUNCTION calculate_age(birth_date DATE)
RETURNS INTEGER AS $$
BEGIN
    RETURN DATE_PART('year', AGE(birth_date));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Trigger: atualizar updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers
CREATE TRIGGER users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER pois_updated_at
    BEFORE UPDATE ON pois
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER subscriptions_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Limpar localizações expiradas
CREATE OR REPLACE FUNCTION cleanup_expired_locations()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM locations WHERE expires_at < NOW() - INTERVAL '30 days';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- SEEDS: interests
-- ============================================

INSERT INTO interests (name, icon, category) VALUES
    ('Música', 'music', 'lifestyle'),
    ('Viagem', 'travel', 'lifestyle'),
    ('Esporte', 'sports', 'lifestyle'),
    ('Culinária', 'food', 'lifestyle'),
    ('Filmes', 'movies', 'entertainment'),
    ('Séries', 'tv', 'entertainment'),
    ('Leitura', 'books', 'lifestyle'),
    ('Games', 'gaming', 'entertainment'),
    ('Praia', 'beach', 'lifestyle'),
    ('Academia', 'fitness', 'lifestyle'),
    ('Yoga', 'yoga', 'lifestyle'),
    ('Pets', 'pets', 'lifestyle'),
    ('Fotografia', 'photography', 'creative'),
    ('Arte', 'art', 'creative'),
    ('Tecnologia', 'tech', 'lifestyle'),
    ('Empreendedorismo', 'business', 'lifestyle'),
    ('Cerveja', 'beer', 'food'),
    ('Vinho', 'wine', 'food'),
    ('Café', 'coffee', 'food'),
    ('Dança', 'dance', 'entertainment');
```

---

## 🔴 Redis — Presença em Tempo Real

### Visão geral
- **Versão:** 7+
- **Uso:** cache, presença real-time, rate limiting, pub/sub
- **Persistência:** AOF + RDB híbrido
- **Cluster:** necessário quando > 100k conexões simultâneas

### Estruturas

#### 1. Presença por Geohash (Sorted Set)

**Chave:** `presence:{geohash_5}` (ex: `presence:u3gy2`)
**Score:** timestamp de registro
**Member:** user_id
**TTL:** 5 horas

```bash
ZADD presence:u3gy2 1698765432 user_abc123
EXPIRE presence:u3gy2 18000
```

**Uso:** listar usuários ativos numa região (5 chars = ~5km²)

#### 2. Localização Atual do Usuário (Hash)

**Chave:** `user:loc:{user_id}`
**Campos:** lat, lng, geohash, poi_id, mode, updated_at
**TTL:** 5 horas

```bash
HSET user:loc:abc123 lat -18.9123 lng -48.2765 geohash u3gy2 mode visible
EXPIRE user:loc:abc123 18000
```

**Uso:** pegar coordenadas exatas pra renderizar avatar no mapa

#### 3. Geohash Vizinhos (Set)

**Chave:** `geohash:neighbors:{geohash}`
**Members:** próprio + vizinhos (8 direções)

```bash
SADD geohash:neighbors:u3gy2 u3gy2 u3gy3 u3gy8 u3gy9 u3gyw u3gyq u3gyt u3gyx u3gyz
```

**Uso:** query expandida (busca em área ao redor do usuário)

#### 4. Hotspots Ativos (Sorted Set)

**Chave:** `hotspots:{city}`
**Score:** número de pessoas
**Member:** poi_id

```bash
ZADD hotspots:uberlandia 47 123
ZADD hotspots:uberlandia 12 456
```

**Uso:** pulse effect em locais com muita gente

#### 5. Fila de Notificações (List)

**Chave:** `queue:notifications`
**Elementos:** JSON com payload

```bash
LPUSH queue:notifications '{"user_id":"...","type":"match","data":{...}}'
```

**Uso:** worker processa e envia via FCM

#### 6. Rate Limiting (String)

**Chave:** `rate:{user_id}:{action}`
**TTL:** janela de tempo

```bash
INCR rate:abc123:like
EXPIRE rate:abc123:like 86400
```

**Uso:** prevenir abuso (200 likes/dia)

#### 7. Chat Pub/Sub (Channel)

**Chave:** `chat:{match_id}`

```bash
PUBLISH chat:match_xyz '{"sender":"abc","content":"Oi!"}'
```

**Uso:** distribuir mensagens entre instâncias do backend

#### 8. Cache de Perfil (Hash)

**Chave:** `profile:{user_id}`
**TTL:** 1 hora

```bash
HSET profile:abc123 name "Mariana" age 26 photos '["url1","url2"]'
EXPIRE profile:abc123 3600
```

**Uso:** reduzir queries no Postgres

#### 9. Super Curtidas Restantes (String)

**Chave:** `super_likes:{user_id}:{YYYY-MM-DD}`
**TTL:** 24h

```bash
DECR super_likes:abc123:2025-01-15
EXPIRE super_likes:abc123:2025-01-15 86400
```

**Uso:** rate limit diário de super curtidas

#### 10. Boost Ativo (String JSON)

**Chave:** `boost:{user_id}`
**TTL:** 1 hora

```bash
SET boost:abc123 '{"location":[-18.91,-48.27],"radius":5000}' EX 3600
```

**Uso:** flag de boost ativo pro algoritmo de mapa

---

## 📊 Estratégias de Query

### Pessoas próximas (5km)

```sql
-- Usando PostGIS
SELECT
    u.id,
    u.name,
    u.birth_date,
    l.latitude,
    l.longitude,
    l.recorded_at,
    ST_Distance(
        l.location,
        ST_MakePoint(-48.2765, -18.9123)::geography
    ) AS distance_m
FROM active_users_5h u
JOIN locations l ON l.user_id = u.id
WHERE
    ST_DWithin(
        l.location,
        ST_MakePoint(-48.2765, -18.9123)::geography,
        5000  -- 5km em metros
    )
ORDER BY distance_m ASC
LIMIT 50;
```

### POIs próximos (com categoria)

```sql
SELECT *
FROM pois
WHERE
    ST_DWithin(
        location,
        ST_MakePoint(-48.2765, -18.9123)::geography,
        2000
    )
    AND category = ANY(ARRAY['bar', 'restaurant', 'cafe'])
ORDER BY rating DESC NULLS LAST
LIMIT 20;
```

### Detecção de match mútuo

```sql
-- Ao receber like de A → B
SELECT 1
FROM likes
WHERE liker_id = :b AND liked_id = :a
LIMIT 1;
```

---

## 🧹 Jobs de Limpeza

### Cron jobs (Bull)

```typescript
// 1. Limpar localizações expiradas (todo dia às 3h)
@Cron('0 3 * * *')
async cleanupExpiredLocations() {
    await db.$queryRaw`SELECT cleanup_expired_locations()`;
}

// 2. Marcar matches expirados (a cada hora)
@Cron('0 * * * *')
async expireOldMatches() {
    await db.matches.updateMany({
        where: {
            chat_expires_at: { lt: new Date() },
            status: 'active',
        },
        data: { status: 'expired' },
    });
}

// 3. Notificar matches expirando (a cada hora)
@Cron('0 * * * *')
async notifyExpiringChats() {
    const expiring = await db.matches.findMany({
        where: {
            chat_expires_at: {
                between: [now, addHours(now, 12)],
            },
            status: 'active',
            notified_expiring: false,
        },
    });
    // Envia push notification
}

// 5. Limpar pedidos de deletação (todo dia)
@Cron('0 4 * * *')
async processDeletions() {
    // Deleta contas com mais de 30 dias de solicitação
}
```

---

## 🔐 Segurança do Banco

### Conexão
- TLS obrigatório (`sslmode=require`)
- Senha em variável de ambiente (não commit)
- Connection pool com PgBouncer (100 conexões)

### Permissões
- App user: SELECT, INSERT, UPDATE nas tabelas
- Migration user: ALL (só usado em migrations)
- Read-only user: SELECT (pra analytics)

### Backup
- Automático diário (RDS)
- Retenção: 7 dias
- Point-in-time recovery habilitado

---

## 📈 Performance Esperada

### Tamanho estimado (100k MAU)

| Tabela | Tamanho estimado | Linhas |
|--------|------------------|--------|
| users | ~50 MB | 100k |
| photos | ~5 GB (metadados) + R2 | 600k |
| locations | ~10 GB/ano | 100M/ano |
| matches | ~50 MB | 500k |
| messages | ~30 GB/ano | 50M/ano |
| pois | ~50 MB | 200k |

### Queries por segundo (pico)

- Location update: **500 QPS** (1 a cada 5min × 100k ativos)
- Nearby users: **1.000 QPS** (abertura de mapa)
- Chat messages: **200 QPS**
- Match detection: **50 QPS**

Postgres aguenta isso tranquilo com índices adequados.

---

**Versão:** 1.0
**Status:** ✅ Aprovado
**Próximo:** [09-api-endpoints.md](./09-api-endpoints.md)