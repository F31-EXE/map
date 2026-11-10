import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatClock, timeAgo } from '../lib/geo';
import { checkpointsPassed } from '../lib/gameModes';
import { isOrder, MARKER_KINDS } from '../lib/markerKinds';
import { lowPower, powerText } from '../lib/power';
import { ROLES } from '../lib/roles';
import type { Member, TacMarker } from '../lib/types';
import { STALE_MS } from '../map/TacticalMap';

import { Icon, tap, type IconName } from './components';
import { C, F, R } from './theme';

export type HqSquad = { id: string; name: string; color: string; members: Member[] };
export type HqGroup = { id: string; name: string; color: string; squads: HqSquad[] };

type Event = { key: string; t: number; icon: IconName; color: string; text: string; target?: { lat: number; lng: number } };

const MAX_EVENTS = 150;
/** Orders and enemy marks older than this aren't news any more. */
const MARK_NEWS_MS = 2 * 3600_000;

/**
 * HQ for wide screens (a laptop at the command post): every squad and fighter with
 * status, link and battery, and a feed of what happened (deaths, orders, enemy marks,
 * captures, convoys). Fighter events are seen from the moment this panel is open; marker
 * events come from the markers themselves, so they include what happened before.
 */
export function HqPanel({
  width,
  groups,
  markers,
  sideName,
  onFocus,
}: {
  width: number;
  groups: HqGroup[];
  markers: TacMarker[];
  sideName: (id: string | null | undefined) => string;
  onFocus: (p: { lat: number; lng: number }, memberId?: string) => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const fighters = useMemo(
    () => groups.flatMap((g) => g.squads.flatMap((s) => s.members.map((m) => ({ m, squad: s.name })))),
    [groups]
  );

  // Fighter events: seen as changes while the panel is open.
  const [fighterEvents, setFighterEvents] = useState<Event[]>([]);
  const seen = useRef(new Map<string, { status: string; low: boolean }>());
  useEffect(() => {
    const fresh: Event[] = [];
    const t = Date.now();
    for (const { m, squad } of fighters) {
      const prev = seen.current.get(m.id);
      const low = lowPower(m);
      seen.current.set(m.id, { status: m.status, low });
      if (!prev) continue;
      const at = m.lat != null && m.lng != null ? { lat: m.lat, lng: m.lng } : undefined;
      const who = `${m.callsign} (${squad})`;
      if (prev.status !== m.status) {
        if (m.status === 'dead') fresh.push({ key: `dead:${m.id}:${t}`, t, icon: 'skull', color: C.danger, text: `${who} убит`, target: at });
        else if (m.status === 'afk') fresh.push({ key: `afk:${m.id}:${t}`, t, icon: 'sleep', color: C.warn, text: `${who} отошёл`, target: at });
        else fresh.push({ key: `alive:${m.id}:${t}`, t, icon: 'heart-pulse', color: C.online, text: `${who} снова в игре`, target: at });
      }
      if (low && !prev.low) {
        fresh.push({ key: `low:${m.id}:${t}`, t, icon: 'battery-alert-variant-outline', color: C.warn, text: `У ${who} садится батарея: ${powerText(m)}`, target: at });
      }
    }
    if (fresh.length) setFighterEvents((cur) => [...fresh, ...cur].slice(0, MAX_EVENTS));
  }, [fighters]);

  // Convoy checkpoints: seen as they're passed while the panel is open.
  const [convoyEvents, setConvoyEvents] = useState<Event[]>([]);
  const passed = useRef(new Map<string, number>());
  useEffect(() => {
    const fresh: Event[] = [];
    const t = Date.now();
    for (const m of markers) {
      if (m.kind !== 'ball' || !m.points?.length) continue;
      const n = checkpointsPassed(m.points, m.ball?.progress ?? 0);
      const prev = passed.current.get(m.id);
      passed.current.set(m.id, n);
      if (prev == null || n <= prev || m.ball?.goal) continue;
      fresh.push({
        key: `cp:${m.id}:${n}`,
        t,
        icon: 'flag-checkered',
        color: C.info,
        text: `Конвой стороны «${sideName(m.owner)}» прошёл чекпойнт ${n} из ${m.points.length - 1}`,
        target: { lat: m.lat, lng: m.lng },
      });
    }
    if (fresh.length) setConvoyEvents((cur) => [...fresh, ...cur].slice(0, MAX_EVENTS));
  }, [markers, sideName]);

  // Marker events: straight from the markers (orders, enemy, captures, goals).
  const markerEvents = useMemo(() => {
    const out: Event[] = [];
    const cutoff = Date.now() - MARK_NEWS_MS;
    for (const m of markers) {
      const at = { lat: m.lat, lng: m.lng };
      const k = MARKER_KINDS[m.kind];
      const by = m.createdByName ? ` — ${m.createdByName}` : '';
      if (isOrder(m.kind) && m.createdAt > cutoff) {
        out.push({ key: `order:${m.id}`, t: m.createdAt, icon: k.icon, color: C.accent, text: `Приказ «${k.title}»${m.label ? `: ${m.label}` : ''}${by}`, target: at });
      } else if (m.kind === 'enemy' && m.createdAt > cutoff) {
        out.push({ key: `enemy:${m.id}`, t: m.createdAt, icon: k.icon, color: C.danger, text: `Противник${m.label ? `: ${m.label}` : ''}${by}`, target: at });
      } else if ((m.kind === 'flag' || m.kind === 'sector') && m.log?.length) {
        const what = m.kind === 'flag' ? `Флаг «${m.label || 'флаг'}»` : `Территория ${m.label}`;
        for (const e of m.log) {
          out.push({ key: `cap:${m.id}:${e.t}`, t: e.t, icon: m.kind === 'flag' ? 'flag' : 'hexagon-outline', color: C.info, text: `${what} — за стороной «${sideName(e.s)}»`, target: at });
        }
      } else if (m.kind === 'ball' && m.ball?.goal) {
        out.push({ key: `goal:${m.id}`, t: m.ball.goal, icon: 'truck-check', color: C.accent, text: `Конвой стороны «${sideName(m.owner)}» доставлен на базу`, target: at });
      }
    }
    return out;
  }, [markers, sideName]);

  const events = useMemo(
    () => [...fighterEvents, ...convoyEvents, ...markerEvents].sort((a, b) => b.t - a.t).slice(0, MAX_EVENTS),
    [fighterEvents, convoyEvents, markerEvents]
  );

  const total = fighters.length;
  const dead = fighters.filter(({ m }) => m.status === 'dead').length;
  const offline = fighters.filter(({ m }) => !m.updatedAt || now - m.updatedAt > STALE_MS).length;
  const low = fighters.filter(({ m }) => lowPower(m)).length;

  return (
    <View style={[styles.panel, { width }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Штаб</Text>
        <Text style={styles.counts}>
          бойцов {total} · убиты {dead} · без связи {offline}
          {low ? ` · батарея ${low}` : ''}
        </Text>
      </View>

      <ScrollView style={{ flex: 1.2 }} contentContainerStyle={{ padding: 12, gap: 14 }}>
        {groups.length === 0 && (
          <Text style={styles.empty}>Отряды появятся здесь, когда вы в отряде, командуете стороной или ведёте игру.</Text>
        )}
        {groups.map((g) => (
          <View key={g.id} style={{ gap: 8 }}>
            {groups.length > 1 && (
              <View style={styles.groupHead}>
                <View style={[styles.dot, { backgroundColor: g.color }]} />
                <Text style={styles.group}>{g.name}</Text>
              </View>
            )}
            {g.squads.map((s) => (
              <View key={s.id} style={styles.squad}>
                <View style={styles.squadHead}>
                  <View style={[styles.squadBar, { backgroundColor: s.color }]} />
                  <Text style={styles.squadName} numberOfLines={1}>
                    {s.name}
                  </Text>
                  <Text style={styles.squadCount}>
                    {s.members.filter((m) => m.status !== 'dead').length}/{s.members.length}
                  </Text>
                </View>
                {s.members.map((m) => (
                  <FighterRow key={m.id} m={m} now={now} onPress={() => m.lat != null && m.lng != null && onFocus({ lat: m.lat, lng: m.lng }, m.id)} />
                ))}
              </View>
            ))}
          </View>
        ))}
      </ScrollView>

      <View style={styles.feedHead}>
        <Icon name="timeline-text-outline" size={16} color={C.dim} />
        <Text style={styles.feedTitle}>События</Text>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12, gap: 2 }}>
        {events.length === 0 && <Text style={styles.empty}>Пока тихо. Здесь появятся смерти, приказы, метки противника и захваты.</Text>}
        {events.map((e) => (
          <Pressable
            key={e.key}
            disabled={!e.target}
            onPress={() => {
              tap();
              if (e.target) onFocus(e.target);
            }}
            style={({ pressed }) => [styles.event, pressed && { backgroundColor: C.elevated }]}
          >
            <Text style={styles.eventTime}>{formatClock(e.t)}</Text>
            <Icon name={e.icon} size={16} color={e.color} />
            <Text style={styles.eventText}>{e.text}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function FighterRow({ m, now, onPress }: { m: Member; now: number; onPress: () => void }) {
  const stale = !m.updatedAt || now - m.updatedAt > STALE_MS;
  const color = m.status === 'dead' ? C.danger : m.status === 'afk' ? C.warn : stale ? C.faint : C.online;
  const power = powerText(m);
  const low = lowPower(m);
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [styles.fighter, pressed && { backgroundColor: C.elevated }]}
    >
      <View style={[styles.dot, { backgroundColor: color }]} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.callsign, m.status === 'dead' && { color: C.dim, textDecorationLine: 'line-through' }]} numberOfLines={1}>
          {m.callsign}
          <Text style={styles.role}> · {ROLES[m.role].title}</Text>
        </Text>
        <Text style={[styles.meta, stale && m.status === 'alive' && { color: C.warn }]} numberOfLines={1}>
          {m.status === 'dead' ? 'убит' : m.status === 'afk' ? 'отошёл' : stale ? 'нет связи' : 'в игре'}
          {m.updatedAt ? ` · ${timeAgo(m.updatedAt, now)}` : ''}
        </Text>
      </View>
      {power && (
        <Text style={[styles.power, low && { color: C.warn }]} numberOfLines={2}>
          {power}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: C.surface, borderLeftWidth: 1, borderLeftColor: C.line },
  header: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: C.line, gap: 2 },
  title: { color: C.text, fontFamily: F.mono, fontSize: 15, letterSpacing: 3, textTransform: 'uppercase' },
  counts: { color: C.dim, fontFamily: F.regular, fontSize: 13 },
  empty: { color: C.dim, fontFamily: F.regular, fontSize: 13, lineHeight: 18, paddingVertical: 6 },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  group: { color: C.text, fontFamily: F.bold, fontSize: 15 },
  squad: { borderRadius: R.md, borderWidth: 1, borderColor: C.line, backgroundColor: C.bg, overflow: 'hidden' },
  squadHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 10, paddingVertical: 8 },
  squadBar: { width: 4, alignSelf: 'stretch' },
  squadName: { flex: 1, color: C.text, fontFamily: F.semibold, fontSize: 14 },
  squadCount: { color: C.dim, fontFamily: F.mono, fontSize: 12 },
  fighter: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 7 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  callsign: { color: C.text, fontFamily: F.semibold, fontSize: 14 },
  role: { color: C.dim, fontFamily: F.regular, fontSize: 12 },
  meta: { color: C.dim, fontFamily: F.regular, fontSize: 12 },
  power: { color: C.dim, fontFamily: F.mono, fontSize: 11, textAlign: 'right', maxWidth: 110 },
  feedHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.line },
  feedTitle: { color: C.dim, fontFamily: F.mono, fontSize: 12, letterSpacing: 2, textTransform: 'uppercase' },
  event: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 6, paddingHorizontal: 4, borderRadius: R.sm },
  eventTime: { color: C.faint, fontFamily: F.mono, fontSize: 12, width: 42 },
  eventText: { flex: 1, color: C.text, fontFamily: F.regular, fontSize: 13, lineHeight: 18 },
});
