# 09 — API Endpoints

> REST + WebSocket.
> Documentação completa pra devs mobile e parceiros externos.

---

## 📋 Visão Geral

### Base URL
- **Produção:** `https://api.cruzei.com/v1`
- **Staging:** `https://api.staging.cruzei.com/v1`
- **WebSocket:** `wss://ws.cruzei.com`

### Autenticação
```
Authorization: Bearer {jwt_access_token}
```

### Versionamento
- URL: `/v1`, `/v2`, etc
- Header alternativo: `X-API-Version: 1`

### Rate Limiting
| Endpoint | Limite |
|----------|--------|
| Login | 5/min por IP |
| Authenticated (geral) | 100/min por user |
| Likes | 200/dia por user |
| Messages | 50/hora por match |
| Photo upload | 20/dia por user |

Resposta quando excedido:
```json
HTTP 429
{
  "error": "rate_limit_exceeded",
  "message": "Too many requests",
  "retry_after": 60
}
```

### Códigos HTTP
| Código | Significado |
|--------|-------------|
| 200 | OK |
| 201 | Created |
| 204 | No content |
| 400 | Bad request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not found |
| 409 | Conflict |
| 422 | Unprocessable entity (validação) |
| 429 | Too many requests |
| 500 | Server error |

---

## 🔐 AUTENTICAÇÃO

### POST /auth/request-code
Envia SMS code pro telefone.

```json
Request:
{
  "phone": "+5534999999999"
}

Response 200:
{
  "sent": true,
  "expires_in": 300
}
```

### POST /auth/login
Valida código e retorna tokens.

```json
Request:
{
  "phone": "+5534999999999",
  "code": "123456"
}

Response 200:
{
  "user": {
    "id": "uuid",
    "name": "Mariana",
    "phone": "+5534999999999",
    "is_new": false
  },
  "token": "eyJhbGc...",
  "refresh_token": "..."
}

Response 401 (código inválido):
{
  "error": "invalid_code",
  "message": "Código inválido ou expirado"
}
```

### POST /auth/register
Cadastro inicial (após verificar telefone).

```json
Request:
{
  "phone": "+5534999999999",
  "name": "Mariana",
  "birth_date": "1999-03-15",
  "gender": "female",
  "orientation": "heterosexual"
}

Response 201:
{
  "user": { ... perfil completo ... },
  "token": "...",
  "refresh_token": "..."
}
```

### POST /auth/refresh
Renova access token expirado.

```json
Request:
{
  "refresh_token": "..."
}

Response 200:
{
  "token": "...",
  "refresh_token": "..."
}
```

### POST /auth/logout
Invalida tokens.

```
Response 204
```

### POST /auth/verify-apple
Valida token do Sign in with Apple.

### POST /auth/verify-google
Valida token do Google Sign-In.

### DELETE /auth/account
Solicita deleção da conta (LGPD — executa em 30 dias).

```json
Request:
{
  "reason": "user_request"
}

Response 202:
{
  "scheduled_for": "2025-02-15T00:00:00Z",
  "cancel_url": "/auth/account/cancel"
}
```

---

## 👤 PERFIL

### GET /me
Retorna perfil completo do usuário logado.

```json
Response 200:
{
  "id": "uuid",
  "phone": "+5534999999999",
  "name": "Mariana",
  "birth_date": "1999-03-15",
  "age": 26,
  "gender": "female",
  "orientation": "heterosexual",
  "looking_for": "relationship",
  "bio": "Adoro rock e café",
  "photos": [
    {
      "id": "uuid",
      "url": "https://cdn.cruzei.com/...",
      "thumbnail_url": "...",
      "is_main": true,
      "order_index": 0
    }
  ],
  "interests": ["music", "coffee", "travel"],
  "seals": [
    { "type": "cafeteria", "progress": 3, "target": 5, "is_completed": false }
  ],
  "premium_tier": "free",
  "is_verified": false,
  "profile_completeness": 80,
  "settings": {
    "visibility_mode": "visible",
    "show_distance": true,
    "is_paused": false
  },
  "stats": {
    "likes_received": 12,
    "matches": 5,
    "super_likes_today": 0
  },
  "created_at": "2025-01-01T00:00:00Z"
}
```

### PATCH /me
Atualiza dados do perfil.

```json
Request:
{
  "name": "Mariana",
  "bio": "Adoro rock e café",
  "looking_for": "relationship",
  "interests": ["music", "coffee", "travel"]
}

Response 200: { ... perfil atualizado ... }
```

### POST /me/photos
Upload de foto (multipart/form-data).

```
POST /me/photos
Content-Type: multipart/form-data

Body:
  photo: <binary>
  order_index: 0

Response 201:
{
  "id": "uuid",
  "url": "https://cdn.cruzei.com/...",
  "thumbnail_url": "...",
  "order_index": 0,
  "is_main": false
}
```

### DELETE /me/photos/:id
Remove foto.

```
Response 204
```

### PUT /me/photos/reorder
Reordena fotos.

```json
Request:
{
  "photo_ids": ["uuid1", "uuid2", "uuid3"]
}

Response 200: { ... fotos atualizadas ... }
```

### PUT /me/photos/:id/main
Define foto principal.

### POST /me/verify
Inicia verificação por selfie.

```json
Request:
{
  "selfie_url": "https://cdn.cruzei.com/..."  // URL temporária após upload
}

Response 200:
{
  "verification_id": "uuid",
  "status": "processing"
}
```

### GET /me/verification/status
Checa status da verificação.

### PATCH /me/settings
Configurações de privacidade.

```json
Request:
{
  "visibility_mode": "anonymous",
  "show_distance": false,
  "show_age": true
}

Response 200: { ... settings atualizados ... }
```

### PATCH /me/pause
Pausa o app por X horas.

```json
Request:
{
  "duration_hours": 24
}

Response 200:
{
  "paused_until": "2025-01-16T22:00:00Z"
}
```

### GET /me/export
Exporta todos os dados do usuário (LGPD).

```
Response 200:
{
  "download_url": "https://...",
  "expires_at": "..."
}
```

---

## 📍 LOCALIZAÇÃO

### POST /location/update
Atualiza localização atual.

```json
Request:
{
  "latitude": -18.9123,
  "longitude": -48.2765,
  "accuracy_meters": 20,
  "poi_id": 123,        // opcional
  "city": "Uberlândia",
  "state": "MG"
}

Response 200:
{
  "geohash": "u3gy2",
  "nearby_users": 47,
  "nearby_pois": 12,
  "expires_at": "2025-01-16T03:00:00Z"
}
```

### GET /location/nearby
Pessoas próximas (filtrado por visibilidade).

```
Query:
  ?lat=-18.9123
  &lng=-48.2765
  &radius_meters=5000
  &include_anonymous=true

Response 200:
{
  "users": [
    {
      "id": "uuid",
      "name": "Mariana",
      "age": 26,
      "main_photo_url": "...",
      "latitude": -18.9130,
      "longitude": -48.2770,
      "distance_m": 95,
      "recorded_at": "2025-01-15T20:15:00Z",
      "is_anonymous": false,
      "is_online": true,
      "poi": {
        "id": 123,
        "name": "Bar do Léo"
      }
    }
  ],
  "count": 47
}
```

### GET /location/hotspots
Locais com muitas pessoas.

```
Query:
  ?city=uberlandia
  &min_users=5
  &lat=-18.9123
  &lng=-48.2765
  &radius_meters=10000

Response 200:
{
  "hotspots": [
    {
      "poi": {
        "id": 123,
        "name": "Bar do Léo",
        "category": "bar",
        "rating": 4.6
      },
      "user_count": 47,
      "latitude": -18.9123,
      "longitude": -48.2765,
      "last_user_at": "2025-01-15T22:30:00Z"
    }
  ]
}
```

### GET /location/me
Retorna localização atual do usuário logado.

```json
Response 200:
{
  "latitude": -18.9123,
  "longitude": -48.2765,
  "geohash": "u3gy2",
  "city": "Uberlândia",
  "recorded_at": "2025-01-15T22:00:00Z"
}
```

---

## 🗺️ MAPA

### GET /map/data
Dados principais do mapa (chamado ao abrir app).

```
Query:
  ?lat=-18.9123
  &lng=-48.2765
  &zoom=14
  &mode=visible

Response 200:
{
  "self": {
    "latitude": -18.9123,
    "longitude": -48.2765,
    "geohash": "u3gy2",
    "visibility_mode": "visible"
  },
  "users": [ ... mesmos dados de /location/nearby ... ],
  "hotspots": [ ... mesmos dados de /location/hotspots ... ],
  "pois": [ ... próximos ... ],
  "bounds": {
    "north": -18.8900,
    "south": -18.9300,
    "east": -48.2500,
    "west": -48.2900
  }
}
```

### GET /map/cluster
Cluster de usuários (pra zoom out).

```
Query:
  ?lat=-18.9123
  &lng=-48.2765
  &zoom=10

Response 200:
{
  "clusters": [
    {
      "latitude": -18.91,
      "longitude": -48.27,
      "user_count": 47,
      "geohash": "u3gy"
    }
  ]
}
```

---

## 📍 POIs

### GET /pois/nearby
POIs próximos.

```
Query:
  ?lat=-18.9123
  &lng=-48.2765
  &radius_meters=2000
  &category=bar,restaurant,cafe

Response 200:
{
  "pois": [
    {
      "id": 123,
      "name": "Bar do Léo",
      "category": "bar",
      "subcategory": "pub",
      "latitude": -18.9123,
      "longitude": -48.2765,
      "address": "Rua XX, Centro",
      "rating": 4.6,
      "total_ratings": 234,
      "is_partner": false,
      "distance_m": 100,
      "user_count": 47  // quantos do Cruzei lá
    }
  ]
}
```

### GET /pois/:id
Detalhes de um POI.

```json
Response 200:
{
  "id": 123,
  "name": "Bar do Léo",
  "category": "bar",
  "subcategory": "pub",
  "latitude": -18.9123,
  "longitude": -48.2765,
  "address": "Rua XX, 100, Centro, Uberlândia",
  "neighborhood": "Centro",
  "city": "Uberlândia",
  "state": "MG",
  "rating": 4.6,
  "total_ratings": 234,
  "phone": "+5534999999999",
  "website": "https://...",
  "hours": {
    "mon": "18:00-02:00",
    "tue": "18:00-02:00",
    ...
  },
  "photos": ["url1", "url2"],
  "is_partner": true,
  "partner_offer": "10% off pra usuários Cruzei",
  "user_count": 47,
  "current_users": [ ... 5 visíveis ... ]
}
```

### GET /pois/:id/people
Pessoas do Cruzei neste POI agora.

```json
Response 200:
{
  "users": [
    {
      "id": "uuid",
      "name": "Mariana",
      "age": 26,
      "main_photo_url": "...",
      "is_visible": true,
      "is_anonymous": true
    }
  ],
  "count": 47
}
```

### POST /pois/:id/checkin
Check-in manual (opcional).

```
Response 201:
{
  "checkin_id": 123,
  "expires_at": "..."
}
```

---

## ❤️ MATCH

### POST /likes
Envia curtida.

```json
Request:
{
  "user_id": "uuid",
  "is_super": false
}

Response 200:
{
  "like_id": "...",
  "is_match": false,
  "remaining_today": 99
}

Response 200 (match!):
{
  "like_id": "...",
  "is_match": true,
  "match_id": "uuid",
  "context": "Vocês se cruzaram no Bar do Léo ontem às 22h",
  "chat_expires_at": "2025-01-17T22:00:00Z"
}
```

### POST /likes/super
Atalho pra super curtida (mesma resposta de POST /likes com `is_super: true`).

### DELETE /likes/:user_id
Desfaz curtida (Premium only).

```
Response 204
```

### GET /likes/received
Curtidas recebidas (Premium+ mostra todas).

```
Query:
  ?limit=20
  &offset=0

Response 200:
{
  "likes": [
    {
      "from_user": { ... perfil ... },
      "is_super": true,
      "location": {
        "poi_name": "Bar do Léo",
        "recorded_at": "..."
      },
      "created_at": "..."
    }
  ],
  "count": 23,
  "has_more": true
}
```

### GET /likes/sent
Curtidas enviadas.

### POST /passes
Registra "passar".

```json
Request:
{
  "user_id": "uuid"
}

Response 204
```

### POST /passes/undo
Voltar perfil (Premium).

```json
Request: {}

Response 200:
{
  "user": { ... perfil da pessoa que voltou ... }
}
```

---

## 💬 MATCHES E CHAT

### GET /matches
Lista de matches ativos.

```
Query:
  ?limit=20
  &offset=0

Response 200:
{
  "matches": [
    {
      "id": "uuid",
      "user": {
        "id": "uuid",
        "name": "Mariana",
        "age": 26,
        "main_photo_url": "..."
      },
      "context": "Vocês se cruzaram no Bar do Léo ontem",
      "poi_name": "Bar do Léo",
      "chat_expires_at": "2025-01-17T22:00:00Z",
      "last_message": {
        "content": "...",
        "sender_id": "uuid",
        "created_at": "..."
      },
      "unread_count": 2,
      "matched_at": "2025-01-15T22:00:00Z"
    }
  ],
  "has_more": false
}
```

### GET /matches/:id
Detalhes de um match (com contexto completo).

```json
Response 200:
{
  "id": "uuid",
  "user": { ... perfil completo ... },
  "context": "Vocês se cruzaram no Bar do Léo ontem às 22h",
  "poi": {
    "id": 123,
    "name": "Bar do Léo",
    "address": "..."
  },
  "chat_expires_at": "2025-01-17T22:00:00Z",
  "matched_at": "2025-01-15T22:00:00Z"
}
```

### DELETE /matches/:id
Unmatch.

```
Response 204
```

### GET /matches/:id/messages
Histórico de mensagens.

```
Query:
  ?limit=50
  &before=2025-01-15T22:00:00Z

Response 200:
{
  "messages": [
    {
      "id": "uuid",
      "sender_id": "uuid",
      "type": "text",
      "content": "Oi! Curtiu o show?",
      "media_url": null,
      "read_at": null,
      "created_at": "2025-01-15T22:15:00Z"
    }
  ],
  "has_more": false
}
```

### POST /matches/:id/messages
Envia mensagem.

```json
Request:
{
  "type": "text",
  "content": "Oi! Curtiu o show?",
  "client_id": "temp_abc123"  // pra reconciliação
}

Response 201:
{
  "id": "uuid",
  "client_id": "temp_abc123",
  "created_at": "..."
}
```

### POST /matches/:id/messages/media
Upload de mídia (foto temporária, áudio, gif).

```
POST /matches/:id/messages/media
Content-Type: multipart/form-data

Body:
  type: photo_temp | audio | gif
  file: <binary>

Response 201:
{
  "id": "uuid",
  "type": "photo_temp",
  "media_url": "https://cdn.cruzei.com/...",
  "media_expires_at": "2025-01-15T22:21:10Z",
  "created_at": "..."
}
```

### POST /matches/:id/messages/typing
Indica "digitando...".

```json
Request:
{
  "is_typing": true
}

Response 204
```

### POST /matches/:id/messages/read
Marca mensagens como lidas.

```json
Request:
{
  "message_ids": ["uuid1", "uuid2"]
}

Response 204
```

### POST /matches/:id/renew
Renova chat (se ambos visitaram mesmo local).

```
Response 200:
{
  "chat_expires_at": "2025-01-19T22:00:00Z",
  "renewed_by_hours": 48
}
```

### GET /matches/:id/templates
Templates de primeira mensagem baseados no contexto.

```json
Response 200:
{
  "templates": [
    "Oi! A gente se cruzou no Bar do Léo. Curtiu o show?",
    "E aí! Vi que você também estava lá. Bora trocar uma ideia?",
    "Oi! Match no Bar do Léo. Topa um café qualquer dia?"
  ]
}
```

---

## 🔔 NOTIFICAÇÕES

### GET /notifications
Lista notificações.

```
Query:
  ?limit=20
  &offset=0
  &unread_only=true

Response 200:
{
  "notifications": [
    {
      "id": "uuid",
      "type": "match",
      "title": "É um match!",
      "body": "Vocês se cruzaram no Bar do Léo",
      "data": {
        "match_id": "uuid",
        "user_id": "uuid"
      },
      "read_at": null,
      "sent_at": "2025-01-15T22:00:00Z"
    }
  ],
  "unread_count": 5
}
```

### POST /notifications/:id/read
Marca como lida.

### POST /notifications/read-all
Marca todas como lidas.

### PATCH /notifications/settings
Configura preferências.

```json
Request:
{
  "push_enabled": true,
  "types": {
    "match": true,
    "message": true,
    "like": true,
    "hotspot": false
  },
  "quiet_hours": {
    "enabled": true,
    "start": "22:00",
    "end": "08:00"
  }
}

Response 200: { ... settings ... }
```

---

## 🕶️ ANÔNIMO

### POST /anonymous/enable
Ativa modo anônimo.

```
Response 200:
{
  "visibility_mode": "anonymous",
  "expires_at": "2025-01-16T22:00:00Z"  // 24h pra Free
}
```

### POST /anonymous/disable
Desativa modo anônimo.

### GET /anonymous/curiosities
Pessoas que você curtiu anonimamente que estão visíveis agora (Premium+).

```json
Response 200:
{
  "users": [
    {
      "id": "uuid",
      "name": "Mariana",
      "age": 26,
      "main_photo_url": "...",
      "liked_at": "...",
      "now_visible_at": "..."
    }
  ],
  "count": 3
}
```

### GET /anonymous/limits
Limites do modo anônimo do usuário.

```json
Response 200:
{
  "unlimited": false,
  "expires_at": "2025-01-16T22:00:00Z",
  "hours_remaining": 18
}
```

---

## 👑 PREMIUM

### GET /premium/plans
Planos disponíveis.

```json
Response 200:
{
  "plans": [
    {
      "id": "premium_monthly",
      "tier": "premium",
      "interval": "month",
      "price_cents": 2990,
      "currency": "BRL",
      "trial_days": 7
    },
    {
      "id": "premium_yearly",
      "tier": "premium",
      "interval": "year",
      "price_cents": 19990,
      "currency": "BRL",
      "savings_percent": 44
    },
    {
      "id": "premium_plus_monthly",
      "tier": "premium_plus",
      "interval": "month",
      "price_cents": 4990,
      "currency": "BRL"
    }
  ]
}
```

### POST /premium/subscribe
Inicia assinatura (retorna receipt pra validar).

```json
Request:
{
  "plan_id": "premium_monthly",
  "platform": "ios" | "android" | "web",
  "receipt": "..."  // base64 receipt
}

Response 200:
{
  "subscription_id": "uuid",
  "tier": "premium",
  "expires_at": "2025-02-15T22:00:00Z",
  "trial_active": true
}
```

### POST /premium/verify-receipt
Valida receipt server-side.

### POST /premium/cancel
Cancela assinatura (mantém até fim do ciclo).

```json
Response 200:
{
  "expires_at": "2025-02-15T22:00:00Z",
  "cancelled_at": "2025-01-15T22:00:00Z"
}
```

### GET /premium/status
Status atual.

```json
Response 200:
{
  "tier": "premium",
  "expires_at": "2025-02-15T22:00:00Z",
  "trial_active": false,
  "auto_renew": true,
  "days_remaining": 31
}
```

---

## 🚀 BOOST

### POST /boosts
Compra e ativa boost.

```json
Request:
{
  "duration_hours": 1,
  "latitude": -18.9123,
  "longitude": -48.2765,
  "platform": "ios" | "android",
  "receipt": "..."
}

Response 201:
{
  "id": "uuid",
  "expires_at": "2025-01-15T23:00:00Z",
  "visibility_radius_meters": 5000
}
```

### GET /boosts/active
Boost ativo do usuário.

```json
Response 200:
{
  "id": "uuid",
  "started_at": "...",
  "expires_at": "...",
  "minutes_remaining": 42
}
```

---

## 👁️ VISITAS

### GET /visits/received
Quem visitou meu perfil (Premium).

```json
Response 200:
{
  "visits": [
    {
      "visitor": { ... perfil básico ... },
      "was_anonymous": false,
      "visited_at": "..."
    }
  ]
}
```

### GET /visits/sent
Quem eu visitei.

---

## 🚫 SEGURANÇA

### POST /blocks
Bloqueia um usuário.

```json
Request:
{
  "user_id": "uuid",
  "reason": "spam"  // opcional
}

Response 201
```

### DELETE /blocks/:user_id
Desbloqueia.

### GET /blocks
Lista de bloqueados.

### POST /reports
Denuncia um usuário.

```json
Request:
{
  "user_id": "uuid",
  "reason": "harassment" | "fake" | "spam" | "inappropriate" | "other",
  "description": "...",
  "evidence_urls": ["url1", "url2"]
}

Response 201:
{
  "report_id": "uuid"
}
```

---

## 🔌 WebSocket (Socket.IO)

### Conexão

```javascript
import { io } from 'socket.io-client';

const socket = io('wss://ws.cruzei.com', {
  auth: { token: 'jwt_token' },
  transports: ['websocket'],
});
```

### Eventos do Cliente → Servidor

#### join_presence
Entra na sala de presença (ao abrir mapa).

```javascript
socket.emit('join_presence', {
  city: 'uberlandia',
  geohash: 'u3gy2',
  radius_m: 5000,
});
```

#### leave_presence
Sai da sala (ao fechar mapa).

#### join_match
Entra na sala do match (ao abrir chat).

```javascript
socket.emit('join_match', { match_id: 'uuid' });
```

#### typing
Indica que está digitando.

```javascript
socket.emit('typing', { match_id: 'uuid', is_typing: true });
```

#### message_sent
Confirma envio de mensagem (alternativa ao HTTP).

```javascript
socket.emit('message_sent', {
  match_id: 'uuid',
  client_id: 'temp_abc',
  content: 'Oi!',
});
```

#### heartbeat
Mantém conexão viva.

```javascript
setInterval(() => socket.emit('heartbeat'), 30000);
```

### Eventos do Servidor → Cliente

#### presence_updated
Novo usuário entrou no raio.

```json
{
  "event": "presence_updated",
  "user": {
    "id": "uuid",
    "name": "Mariana",
    "age": 26,
    "photo_url": "...",
    "latitude": -18.91,
    "longitude": -48.27,
    "is_visible": true,
    "is_anonymous": false
  }
}
```

#### presence_left
Usuário saiu do raio.

```json
{
  "event": "presence_left",
  "user_id": "uuid"
}
```

#### hotspot_updated
Hotspot mudou (mais/menos gente).

```json
{
  "event": "hotspot_updated",
  "poi_id": 123,
  "user_count": 47
}
```

#### message_received
Nova mensagem recebida.

```json
{
  "event": "message_received",
  "match_id": "uuid",
  "message": {
    "id": "uuid",
    "sender_id": "uuid",
    "content": "...",
    "type": "text",
    "created_at": "..."
  }
}
```

#### message_delivered
Confirmação de envio.

```json
{
  "event": "message_delivered",
  "client_id": "temp_abc",
  "message_id": "uuid_real"
}
```

#### message_read
Mensagem lida pelo outro.

```json
{
  "event": "message_read",
  "match_id": "uuid",
  "message_ids": ["uuid1"],
  "read_at": "..."
}
```

#### typing_indicator
Outro está digitando.

```json
{
  "event": "typing_indicator",
  "match_id": "uuid",
  "user_id": "uuid",
  "is_typing": true
}
```

#### user_online
Usuário ficou online (match).

```json
{
  "event": "user_online",
  "user_id": "uuid"
}
```

#### user_offline
Usuário ficou offline.

#### match_created
Novo match formado.

```json
{
  "event": "match_created",
  "match": {
    "id": "uuid",
    "user": { ... perfil ... },
    "context": "Vocês se cruzaram no Bar do Léo ontem às 22h",
    "chat_expires_at": "2025-01-17T22:00:00Z"
  }
}
```

#### hotspot_alert
Notificação de novo hotspot.

```json
{
  "event": "hotspot_alert",
  "poi": {
    "id": 123,
    "name": "Bar do Léo",
    "user_count": 47
  }
}
```

#### chat_expiring
Alerta de chat expirando (12h antes).

```json
{
  "event": "chat_expiring",
  "match_id": "uuid",
  "expires_at": "2025-01-17T22:00:00Z",
  "hours_remaining": 12
}
```

### Códigos de Erro WS

| Código | Significado |
|--------|-------------|
| 4001 | Token inválido/expirado |
| 4003 | Sem permissão pra esse match |
| 4004 | Match expirado |
| 4029 | Rate limit excedido |
| 4000 | Erro genérico |

### Reconexão

```javascript
// Cliente deve implementar
socket.on('disconnect', () => {
  setTimeout(() => socket.connect(), backoffMs);
});
// Backoff exponencial: 1s, 2s, 4s, 8s, max 30s
```

---

**Versão:** 1.0
**Status:** ✅ Aprovado
**Próximo:** [10-geolocalizacao-presenca.md](./10-geolocalizacao-presenca.md)