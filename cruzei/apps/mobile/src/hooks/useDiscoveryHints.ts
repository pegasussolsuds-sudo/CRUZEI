// Sensação de descoberta (doc §11) sem spam: observa o que muda no "universo" em volta e solta
// UMA dica por vez, com intervalo mínimo e dedupe por sessão.
//   - "✨ N pessoas novas apareceram perto de você" (a partir do 2º carregamento)
//   - "🔥 <lugar> tá bombando · N pessoas" (hotspot novo — o WebView avisa via hotspotBorn)
//   - "⚡ Evento perto: <nome>" (POI de evento entrou no raio)
//   - "👀 N pessoas online a menos de 250 m" (quando muita gente perto e online)

import { useCallback, useEffect, useRef, useState } from 'react';
import type { NearbyUser, POI } from '@cruzei/shared-types';
import type { DiscoveryHint } from '../components/map/DiscoveryToast';

const MIN_GAP_MS = 45_000;
const NEW_PEOPLE_MIN = 3;
const NEAR_ONLINE_MIN = 4;
const NEAR_ONLINE_M = 250;

export interface HotspotBorn {
  poiId: number;
  name: string;
  userCount: number;
}

/** `scopeKey` identifica o recorte (célula do centro + raio): quando muda, o baseline de 'pessoas novas' recomeça — arrastar o mapa não é gente chegando. */
export function useDiscoveryHints(users: NearbyUser[], pois: POI[], distanceById: ReadonlyMap<string, number>, enabled: boolean, scopeKey: string) {
  const [hint, setHint] = useState<DiscoveryHint | null>(null);
  const seenUsers = useRef<Set<string> | null>(null);
  const scopeRef = useRef(scopeKey);
  const nextTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (nextTimer.current) clearTimeout(nextTimer.current);
  }, []);
  const seenEvents = useRef<Set<number>>(new Set());
  const shownKeys = useRef<Set<string>>(new Set());
  const lastAt = useRef(0);
  const queue = useRef<DiscoveryHint[]>([]);

  const offer = useCallback((h: DiscoveryHint, priority = false) => {
    if (shownKeys.current.has(h.key)) return;
    const now = Date.now();
    if (!priority && now - lastAt.current < MIN_GAP_MS) {
      // guarda só a última pendente: dica velha não vale mais
      queue.current = [h];
      return;
    }
    shownKeys.current.add(h.key);
    lastAt.current = now;
    setHint(h);
  }, []);

  // pessoas novas / online perto
  useEffect(() => {
    if (!enabled || users.length === 0) return;
    const ids = new Set(users.map((u) => u.id));
    if (seenUsers.current === null || scopeRef.current !== scopeKey) {
      scopeRef.current = scopeKey;
      seenUsers.current = ids;
      return;
    }
    let fresh = 0;
    for (const id of ids) if (!seenUsers.current.has(id)) fresh += 1;
    seenUsers.current = ids;
    if (fresh >= NEW_PEOPLE_MIN) {
      offer({ key: `new-${Date.now()}`, text: `✨ ${fresh} pessoas novas apareceram perto de você`, tone: 'info' });
      return;
    }
    const nearOnline = users.filter((u) => u.isOnline && (distanceById.get(u.id) ?? u.distanceM ?? Infinity) <= NEAR_ONLINE_M).length;
    if (nearOnline >= NEAR_ONLINE_MIN) offer({ key: 'near-online', text: `👀 ${nearOnline} pessoas online a menos de ${NEAR_ONLINE_M} m`, tone: 'info' });
  }, [users, distanceById, enabled, offer, scopeKey]);

  // eventos que entraram no raio
  useEffect(() => {
    if (!enabled) return;
    for (const p of pois) {
      if (p.category !== 'event' || seenEvents.current.has(p.id)) continue;
      seenEvents.current.add(p.id);
      offer({ key: `event-${p.id}`, text: `⚡ Evento perto: ${p.name}`, tone: 'event', poiId: p.id });
    }
  }, [pois, enabled, offer]);

  // hotspot nascendo tem prioridade (é o momento do "🔥")
  const onHotspotBorn = useCallback(
    (h: HotspotBorn) => {
      offer({ key: `hot-${h.poiId}-${h.userCount}`, text: `🔥 ${h.name} tá bombando · ${h.userCount} pessoas`, tone: 'hot', poiId: h.poiId }, true);
    },
    [offer],
  );

  const hide = useCallback(() => {
    setHint(null);
    const next = queue.current.shift();
    if (!next) return;
    // espera o intervalo mínimo que falta (senão a dica voltaria pra fila e nunca sairia)
    const wait = Math.max(800, MIN_GAP_MS - (Date.now() - lastAt.current));
    if (nextTimer.current) clearTimeout(nextTimer.current);
    nextTimer.current = setTimeout(() => offer(next, true), wait);
  }, [offer]);

  return { hint, hide, onHotspotBorn };
}
