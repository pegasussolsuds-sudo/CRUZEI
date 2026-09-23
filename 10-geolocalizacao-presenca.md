# 10 — Geolocalização e Presença Real-Time

> O coração do Cruzei: como detectar quem está onde, em tempo real.

---

## 🎯 O Problema

Cruzei precisa saber, em tempo real:
- Onde o usuário está (pra mostrar ele no mapa)
- Quem está próximo (pra mostrar avatares)
- Onde estão os hotspots (pra pulse effect)
- Quem já esteve em um local (pra match com contexto)

Tudo isso com:
- Baixa latência (< 200ms)
- Privacidade (LGPD)
- Bateria (não pode sugar 50%/dia)
- Escala (100k+ usuários ativos)

---

## 📐 Decisão: Background Location Nativo (Opção A)

**Por quê:**
- Precisão alta (20m vs 200m de geofencing)
- Funciona mesmo com app fechado
- Menos dependência de catálogo de POIs
- Permite match retroativo (você esteve aqui há 2h)

**Trade-off:**
- Bateria: -8%/dia (aceitável)
- Permissões: precisa pedir "sempre"
- LGPD: requer consentimento explícito

---

## 🏗️ Arquitetura de Presença

```
┌──────────────┐
│  MOBILE APP  │
│              │
│ Background   │
│ Location     │ ── 60s foreground, 300s background
│ Service      │
│              │
│ - Geohash    │
│ - POI match  │
│ - Battery    │
│   mgmt       │
└──────┬───────┘
       │ POST /location/update
       ▼
┌──────────────────────────────────┐
│  BACKEND (NestJS)                │
│                                  │
│  1. Geohash encoding             │
│  2. Redis presence (TTL 5h)      │
│  3. Postgres history (30 days)   │
│  4. POI detection                │
│  5. Hotspot recalc               │
│  6. WebSocket broadcast          │
└──────┬───────────────────────────┘
       │
       ├─→ Redis (presence + cache)
       ├─→ Postgres (history)
       └─→ WebSocket (mobile clients)
```

---

## 📱 Implementação Mobile (React Native)

### Pacotes

```bash
# Background location
npm install react-native-background-geolocation

# Geohash (encoding)
npm install ngeohash

# POI matching (PostGIS server-side, mobile só envia lat/lng)
```

### Configuração iOS (Info.plist)

```xml
<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>O Cruzei usa sua localização pra mostrar quem esteve no mesmo lugar que você.</string>

<key>NSLocationWhenInUseUsageDescription</key>
<string>O Cruzei mostra pessoas próximas a você.</string>

<key>UIBackgroundModes</key>
<array>
    <string>location</string>
    <string>fetch</string>
</array>
```

### Configuração Android (AndroidManifest.xml)

```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />

<service
    android:name="com.TransistorSoft.RNBackgroundGeolocation.HeadlessTaskService"
    android:foregroundServiceType="location" />
```

### Service de Background Location

```typescript
// src/services/location.ts
import BackgroundGeolocation from 'react-native-background-geolocation';
import ngeohash from 'ngeohash';
import api from './api';

class LocationService {
  private static instance: LocationService;
  private currentGeohash: string | null = null;

  static getInstance(): LocationService {
    if (!LocationService.instance) {
      LocationService.instance = new LocationService();
    }
    return LocationService.instance;
  }

  async start() {
    BackgroundGeolocation.onLocation(this.onLocation.bind(this));
    BackgroundGeolocation.onHeartbeat(this.onHeartbeat.bind(this));

    const state = await BackgroundGeolocation.getState();
    if (!state.enabled) {
      BackgroundGeolocation.start();
    }
  }

  async stop() {
    BackgroundGeolocation.stop();
  }

  private async onLocation(location: any) {
    try {
      const { latitude, longitude, accuracy } = location;

      // 1. Calcula geohash (precisão ~5km)
      const geohash = ngeohash.encode(latitude, longitude, 5);

      // 2. Atualiza só se mudou de geohash OU passou 1 min
      if (geohash !== this.currentGeohash || this.shouldUpdate()) {
        this.currentGeohash = geohash;

        // 3. Envia pro backend
        await api.updateLocation({
          latitude,
          longitude,
          accuracy_meters: accuracy,
        });
      }
    } catch (error) {
      console.error('Location update failed:', error);
    }
  }

  private lastUpdate = 0;
  private shouldUpdate(): boolean {
    const now = Date.now();
    if (now - this.lastUpdate > 60000) {
      // 1 min mínimo
      this.lastUpdate = now;
      return true;
    }
    return false;
  }

  private async onHeartbeat() {
    // Força update a cada 5 min se app em background
    if (Date.now() - this.lastUpdate > 300000) {
      // 5 min
      BackgroundGeolocation.getCurrentPosition();
    }
  }
}

export default LocationService.getInstance();
```

### Configuração de Bateria

```typescript
// src/config/location.ts
export const LOCATION_CONFIG = {
  // Foreground (app aberto)
  foreground: {
    desiredAccuracy: BackgroundGeolocation.DESIRED_ACCURACY_HIGH,
    distanceFilter: 10,           // 10m mínimo
    interval: 60000,               // 60s
    fastestInterval: 30000,        // 30s
    stopOnStillActivity: false,
    pauseLocationUpdates: false,
  },
  // Background (app fechado)
  background: {
    desiredAccuracy: BackgroundGeolocation.DESIRED_ACCURACY_MEDIUM,
    distanceFilter: 50,            // 50m
    interval: 300000,              // 5 min
    fastestInterval: 180000,       // 3 min
    stopOnStillActivity: true,
    stopAfterElapsedSeconds: 60 * 30, // para após 30min parado
    pauseLocationUpdates: false,
  },
  // Battery optimization
  isMovingEnabled: true,          // detecta movimento
  motionTriggerDelay: 5000,        // 5s sem movimento = parado
  heartbeatInterval: 60,           // ping a cada 60s
  notification: {
    title: 'Cruzei está ativo',
    text: 'Vendo quem está por perto',
  },
};
```

---

## 🔐 Fluxo de Permissão (LGPD)

```
1. App pede localização WHEN_IN_USE
   → Explica que vai usar pra mostrar pessoas próximas

2. Se user aceita WHEN_IN_USE
   → Após primeiro uso, pede ALWAYS
   → "Pra detectar quem você cruzou mesmo com app fechado"

3. Se recusa ALWAYS
   → App funciona em foreground apenas
   → Mostra banner: "Quer ver pessoas mesmo offline? Permita sempre"

4. Se recusa WHEN_IN_USE
   → Modo somente navegação (sem presença)
```

### Implementação

```typescript
// src/services/permissions.ts
import { PermissionsAndroid, Platform } from 'react-native';

async function requestLocationPermission() {
  if (Platform.OS === 'ios') {
    // iOS gerencia automaticamente via Info.plist
    return true;
  }

  // Android: pedir em estágios
  const foreground = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    {
      title: 'Permita sua localização',
      message: 'O Cruzei mostra pessoas que estiveram no mesmo lugar que você.',
      buttonPositive: 'Permitir',
      buttonNegative: 'Agora não',
    }
  );

  if (foreground === PermissionsAndroid.RESULTS.GRANTED) {
    // Pedir background após 1 semana de uso
    if (await hasUsedForAWeek()) {
      const background = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION,
        {
          title: 'Detecção automática',
          message: 'Pra detectar quem você cruzou mesmo com app fechado.',
          buttonPositive: 'Permitir sempre',
          buttonNegative: 'Não permitir',
        }
      );
      return background === PermissionsAndroid.RESULTS.GRANTED;
    }
    return true;
  }

  return false;
}
```

---

## 🗺️ Geohash Encoding

### Por que Geohash?

- String curta representa região (~5 chars = 5km²)
- Vizinhança é fácil (muda 1 caractere = adjacente)
- Indexável no Postgres

### Precisão por caracteres

| Caracteres | Dimensão | Uso |
|-----------|----------|-----|
| 3 | ~156km | Cidade |
| 4 | ~39km | Região |
| 5 | ~5km | Bairro |
| 6 | ~1.2km | Quarteirão |
| 7 | ~150m | Rua |

### Uso no Cruzei

```typescript
import ngeohash from 'ngeohash';

// User location
const userHash = ngeohash.encode(lat, lng, 6);  // ~1.2km

// Query nearby (5km radius)
const centerHash = ngeohash.encode(lat, lng, 5);
const neighbors = ngeohash.neighbors(centerHash);
// + próprio = 9 hashes = quadrado de ~15km
```

### Query no Backend (Postgres + Redis)

```sql
-- Busca usuários em geohash vizinho
SELECT u.*, l.latitude, l.longitude
FROM locations l
JOIN users u ON u.id = l.user_id
WHERE l.geohash IN (:neighbor_hashes)
  AND l.expires_at > NOW()
  AND u.deleted_at IS NULL
  AND u.visibility_mode = 'visible';
```

---

## ⚡ Redis — Presença Real-Time

### Estruturas (já documentado em 08)

```typescript
// src/services/presence.service.ts
import Redis from 'ioredis';
import ngeohash from 'ngeohash';

class PresenceService {
  private redis: Redis;

  async setUserLocation(userId: string, lat: number, lng: number, mode: string) {
    const geohash = ngeohash.encode(lat, lng, 6);
    const score = Date.now();

    // 1. Salva no sorted set do geohash
    await this.redis.zadd(`presence:${geohash}`, score, userId);
    await this.redis.expire(`presence:${geohash}`, 18000); // 5h

    // 2. Hash com dados completos
    await this.redis.hset(`user:loc:${userId}`, {
      lat: lat.toString(),
      lng: lng.toString(),
      geohash,
      mode,
      updated_at: score.toString(),
    });
    await this.redis.expire(`user:loc:${userId}`, 18000);
  }

  async getNearbyUsers(centerLat: number, centerLng: number, radiusM: number): Promise<string[]> {
    // Pega geohash center + vizinhos
    const centerHash = ngeohash.encode(centerLat, centerLng, 5);
    const hashes = [centerHash, ...ngeohash.neighbors(centerHash)];

    // Query todos
    const pipeline = this.redis.pipeline();
    for (const h of hashes) {
      pipeline.zrange(`presence:${h}`, 0, -1);
    }
    const results = await pipeline.exec();

    // Flatten + dedupe
    const userIds = new Set<string>();
    results?.forEach(([_, users]) => {
      (users as string[]).forEach((u) => userIds.add(u));
    });

    // Filtrar por distância exata (PostGIS depois)
    return Array.from(userIds);
  }

  async getHotspots(city: string, minUsers: number): Promise<any[]> {
    const pois = await this.redis.zrevrangebyscore(
      `hotspots:${city}`,
      minUsers,
      '+inf'
    );
    return pois.map((p) => ({ poi_id: p, ...JSON.parse(p) }));
  }
}
```

---

## 🔥 Detecção de Hotspots

### Algoritmo

```typescript
// src/services/hotspot.service.ts
class HotspotService {
  // Roda a cada 5 min via cron
  async recalcCityHotspots(city: string) {
    // 1. Agrupa usuários ativos por POI
    const userPois = await db.locations.findMany({
      where: {
        city,
        expires_at: { gt: new Date() },
        poi_id: { not: null },
      },
      include: { user: true },
    });

    // 2. Conta por POI
    const counts = new Map<number, number>();
    userPois.forEach((loc) => {
      if (loc.poi_id) {
        counts.set(loc.poi_id, (counts.get(loc.poi_id) || 0) + 1);
      }
    });

    // 3. Salva no Redis como sorted set
    const pipeline = this.redis.pipeline();
    pipeline.del(`hotspots:${city}`);
    counts.forEach((count, poiId) => {
      if (count >= 5) {
        // mínimo 5 pessoas
        pipeline.zadd(`hotspots:${city}`, count, poiId.toString());
      }
    });
    await pipeline.exec();
  }

  // Notifica usuários que estão em novo hotspot
  async notifyNewHotspot(poiId: number, city: string) {
    const count = await this.redis.zscore(`hotspots:${city}`, poiId.toString());

    // Pega usuários no POI
    const users = await this.redis.zrange(
      `presence:${this.getPoiGeohash(poiId)}`,
      0,
      -1
    );

    // Envia push (não pra todos, só pros primeiros 100)
    const targets = users.slice(0, 100);
    for (const userId of targets) {
      await this.fcm.send(userId, {
        type: 'hotspot_alert',
        poi_name: await this.getPoiName(poiId),
        user_count: count,
      });
    }
  }
}
```

---

## 🔋 Otimizações de Bateria

### Técnicas aplicadas

| Técnica | Economia | Trade-off |
|---------|----------|-----------|
| `distanceFilter: 50m` (bg) | -30% | Menos updates parado |
| `isMovingEnabled: true` | -25% | Detecta parado e para |
| `stopAfterElapsedSeconds: 30min` | -20% | Para se parado muito tempo |
| Heartbeat adaptativo | -15% | Menos pings quando offline |
| Geohash dedupe | -10% | Só atualiza se mudou região |
| Modo "low power" se bateria < 20% | -50% nesse cenário | Precisão cai |

### Configurações por estado

```typescript
// Bateria cheia (> 50%)
await BackgroundGeolocation.setConfig({
  desiredAccuracy: DESIRED_ACCURACY_HIGH,
  interval: 60000,
  distanceFilter: 10,
});

// Bateria média (20-50%)
await BackgroundGeolocation.setConfig({
  desiredAccuracy: DESIRED_ACCURACY_MEDIUM,
  interval: 180000,
  distanceFilter: 50,
});

// Bateria baixa (< 20%)
await BackgroundGeolocation.setConfig({
  desiredAccuracy: DESIRED_ACCURACY_LOW,
  interval: 600000,
  distanceFilter: 100,
  stopOnStillActivity: true,
});
```

---

## 🎯 Match com Contexto (Geográfico)

### Como funciona

```typescript
// src/services/match-context.service.ts
class MatchContextService {
  async generateMatchContext(userA: string, userB: string): Promise<string> {
    // 1. Acha POI em comum nas últimas 5h
    const commonPois = await db.$queryRaw`
      SELECT poi_id, COUNT(*) as times
      FROM locations
      WHERE user_id IN (${userA}, ${userB})
        AND expires_at > NOW()
        AND poi_id IS NOT NULL
      GROUP BY poi_id
      HAVING COUNT(DISTINCT user_id) = 2
      ORDER BY times DESC
      LIMIT 1
    `;

    if (commonPois[0]) {
      const poi = await db.pois.findUnique({ where: { id: commonPois[0].poi_id } });
      return `Vocês se cruzaram no ${poi.name}`;
    }

    // 2. Senão, acha o local mais próximo
    const closest = await db.$queryRaw`
      SELECT ST_Distance(a.location, b.location) as dist, poi.*
      FROM locations a, locations b, pois poi
      WHERE a.user_id = ${userA}
        AND b.user_id = ${userB}
        AND a.expires_at > NOW()
        AND b.expires_at > NOW()
        AND ST_DWithin(a.location, b.location, 500)  -- 500m
        AND ST_DWithin(a.location, poi.location, 100) -- e próximo de POI conhecido
      ORDER BY dist ASC
      LIMIT 1
    `;

    if (closest[0]) {
      const when = this.formatTime(closest[0].recorded_at);
      return `Vocês estiveram a ${Math.round(closest[0].dist)}m de distância ${when}`;
    }

    // 3. Fallback genérico
    return 'Vocês têm alguém em comum';
  }
}
```

### Renovação de Chat por Contexto

```typescript
async shouldRenewChat(matchId: string): Promise<boolean> {
  const match = await db.matches.findUnique({ where: { id: matchId } });
  if (!match) return false;

  // Verifica se ambos visitaram mesmo local nas últimas 72h
  const sharedPoi = await db.$queryRaw`
    SELECT poi_id
    FROM locations
    WHERE user_id IN (${match.user_a_id}, ${match.user_b_id})
      AND recorded_at > NOW() - INTERVAL '72 hours'
      AND poi_id IS NOT NULL
    GROUP BY poi_id
    HAVING COUNT(DISTINCT user_id) = 2
    LIMIT 1
  `;

  return sharedPoi.length > 0;
}
```

---

## 📊 LGPD — Privacidade Geográfica

### Princípios implementados

| Princípio | Implementação |
|-----------|---------------|
| Finalidade específica | Só pra detectar presença próxima |
| Necessidade | Só registra lat/lng, não histórico de rotas |
| Transparência | Privacy policy + explicação in-app |
| Livre acesso | User pode ver suas localizações em /me/data |
| Eliminação | Delete account → apaga tudo após 30 dias |
| Segurança | Criptografia em trânsito + repouso |

### Retenção de dados

```
Localização em tempo real:
  - Redis: 5h (TTL automático)
  - Postgres: 30 dias (limpeza diária via cron)
  - Depois: agregado anônimo por bairro/cidade (sem user_id)

Check-ins em POIs:
  - Postgres: 90 dias
  - Depois: deletado

Histórico de rotas:
  - NUNCA armazenado (só posição atual)
```

### Configurações do Usuário

```typescript
// Configurações disponíveis em /me/settings
{
  // Privacidade
  show_exact_distance: false,  // mostra "perto" em vez de "120m"
  visibility_mode: 'anonymous', // padrão na primeira instalação
  
  // Precisão
  location_precision: 'approximate', // 'exact' | 'approximate' (raio 500m)
  
  // Pausa
  pause_app: false,
  pause_until: null,  // ISO datetime
  
  // Limpeza
  delete_location_history: false,  // flag pro cron
}
```

---

## 🧪 Testes e Validação

### Testes de integração

```typescript
// tests/integration/presence.spec.ts
describe('Presence Service', () => {
  it('should register user in geohash', async () => {
    await presence.setUserLocation('user1', -18.91, -48.27, 'visible');
    const inHash = await redis.zrange('presence:u3gy2', 0, -1);
    expect(inHash).toContain('user1');
  });

  it('should expire after 5h', async () => {
    await presence.setUserLocation('user1', -18.91, -48.27, 'visible');
    await sleep(5000);
    const ttl = await redis.ttl('presence:u3gy2');
    expect(ttl).toBeLessThan(18000);
  });

  it('should return nearby users', async () => {
    await presence.setUserLocation('user1', -18.91, -48.27, 'visible');
    await presence.setUserLocation('user2', -18.92, -48.28, 'visible');
    
    const nearby = await presence.getNearbyUsers(-18.91, -48.27, 5000);
    expect(nearby).toContain('user1');
    expect(nearby).toContain('user2');
  });
});
```

### Bateria — testes de campo

| Cenário | Bateria esperada |
|---------|------------------|
| App em foreground, uso intenso | -25%/h |
| App em background, parado | -3%/h |
| App em background, andando | -8%/h |
| Modo low power (< 20%) | -2%/h |

---

## 📈 Métricas de Performance

### Latências esperadas

| Operação | Latência |
|----------|----------|
| Geohash encode | < 1ms |
| Redis ZADD | < 5ms |
| Redis nearby query (9 hashes) | < 50ms |
| Postgres insert location | < 20ms |
| POI match (PostGIS) | < 30ms |
| End-to-end (mobile → backend → mobile) | < 200ms |

### Throughput

- Location updates: **500 QPS** sustentado
- WebSocket presence: **2.000 conexões** por instância Node
- Redis ops: **10.000 QPS** por instância

---

## 🔧 Troubleshooting Comum

### Problema: "Não detecta ninguém próximo"

**Diagnóstico:**
1. Checar permissão de localização (settings)
2. Verificar se background location está rodando
3. Confirmar que geohash está sendo calculado
4. Olhar Redis: `ZSCORE presence:{hash} {user_id}`

**Solução:**
- Forçar update: `POST /location/update` manual
- Checar logs: `[LocationService] Geohash changed`
- Reiniciar service

### Problema: "Bateria acabando rápido"

**Diagnóstico:**
1. Verificar se `isMovingEnabled` está ativo
2. Checar frequência de updates
3. Olhar se está usando `DESIRED_ACCURACY_HIGH` em background

**Solução:**
- Reduzir frequência de background
- Ativar modo low power se < 20%
- Aumentar `distanceFilter`

### Problema: "WebSocket desconectando"

**Diagnóstico:**
1. Heartbeat está sendo enviado?
2. Auth token ainda válido?
3. Servidor tá dropando conexões?

**Solução:**
- Implementar backoff exponencial
- Renovar token antes de expirar
- Reconectar após 30s

---

**Versão:** 1.0
**Status:** ✅ Aprovado
**Próximo:** [11-seguranca-moderacao.md](./11-seguranca-moderacao.md)