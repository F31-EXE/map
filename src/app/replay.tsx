import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatClock, formatDistance } from '../lib/geo';
import { TEAM_COLORS } from '../lib/roles';
import { KEYS, loadJson } from '../lib/storage';
import { formatDuration, resampleByTime, splitSegments, trackStats } from '../lib/tracks';
import { TacticalMap, type BaseLayerId } from '../map/TacticalMap';
import { loadTracks, subscribeRecordings, type Recording, type Track } from '../services/recordings';
import { useOverlays } from '../state/overlays';
import { useSession } from '../state/session';
import { Card, Glass, Icon, tap } from '../ui/components';
import { C, F, R } from '../ui/theme';

export default function ReplayScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return id ? <RecordingView id={id} /> : <RecordingList />;
}

function useRecordings() {
  const { teamId } = useSession();
  const [list, setList] = useState<Recording[] | null>(null);
  useEffect(() => {
    if (!teamId) return setList([]);
    return subscribeRecordings(teamId, setList, () => setList([]));
  }, [teamId]);
  return list;
}

const dateTime = (ts: number) =>
  `${new Date(ts).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} ${formatClock(ts)}`;

function RecordingList() {
  const list = useRecordings();
  if (!list) return <ActivityIndicator style={{ marginTop: 40 }} color={C.accent} />;
  return (
    <FlatList
      contentContainerStyle={styles.content}
      data={list}
      keyExtractor={(r) => r.id}
      ListHeaderComponent={
        <Text style={styles.hint}>
          Командир включает запись на экране «Команда». Анализ доступен после остановки записи.
        </Text>
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Icon name="map-marker-path" size={42} color={C.faint} />
          <Text style={styles.emptyText}>Записей пока нет</Text>
        </View>
      }
      renderItem={({ item }) => {
        const live = item.endedAt == null;
        return (
          <Pressable
            disabled={live}
            onPress={() => {
              tap();
              router.push({ pathname: '/replay', params: { id: item.id } });
            }}
          >
            <Card style={styles.item}>
              <View style={[styles.itemIcon, live && { backgroundColor: C.dangerSoft }]}>
                <Icon name={live ? 'record-circle' : 'map-marker-path'} size={22} color={live ? C.danger : C.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle}>{item.name}</Text>
                <Text style={styles.sub}>
                  {dateTime(item.startedAt)}
                  {live ? ' · идёт запись' : ` · ${formatDuration(item.endedAt! - item.startedAt)}`}
                </Text>
              </View>
              {!live && <Icon name="chevron-right" size={20} color={C.faint} />}
            </Card>
          </Pressable>
        );
      }}
    />
  );
}

function RecordingView({ id }: { id: string }) {
  const { teamId } = useSession();
  const { overlays } = useOverlays();
  const recs = useRecordings();
  const rec = recs?.find((r) => r.id === id);
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [showHeat, setShowHeat] = useState(true);
  const [showTracks, setShowTracks] = useState(true);
  const [baseLayer, setBaseLayer] = useState<BaseLayerId>('yandex-sat');
  // Playback: the moment shown (null = the whole game), running or not, how fast.
  const [t, setT] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(30);
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => {
    loadJson<BaseLayerId>(KEYS.baseLayer, 'yandex-sat').then(setBaseLayer);
  }, []);

  useEffect(() => {
    if (!teamId) return;
    loadTracks(teamId, id)
      .then(setTracks)
      .catch((e: Error) => Alert.alert('Не удалось загрузить запись', e.message));
  }, [teamId, id]);

  const colored = useMemo(
    () =>
      (tracks ?? [])
        .filter((t) => t.points.length > 0)
        .map((t, i) => ({ ...t, color: TEAM_COLORS[i % TEAM_COLORS.length], stats: trackStats(t.points) })),
    [tracks]
  );

  const analysis = useMemo(
    () => ({
      tracks: colored.map((t) => ({
        uid: t.uid,
        callsign: t.callsign,
        color: t.color,
        segments: splitSegments(t.points).map((seg) => seg.map((p) => [p.lat, p.lng, p.t] as [number, number, number])),
      })),
      heat: colored.flatMap((t) => resampleByTime(t.points).map((p) => [p.lat, p.lng] as [number, number])),
      showHeat,
      showTracks,
    }),
    [colored, showHeat, showTracks]
  );

  // The game's time span: first to last point (the recording's own times as a fallback).
  const span = useMemo(() => {
    let a = Infinity;
    let b = -Infinity;
    for (const tr of colored) for (const p of tr.points) {
      if (p.t < a) a = p.t;
      if (p.t > b) b = p.t;
    }
    if (!Number.isFinite(a)) return rec ? { a: rec.startedAt, b: rec.endedAt ?? rec.startedAt } : null;
    return { a, b: Math.max(b, a + 1000) };
  }, [colored, rec]);

  useEffect(() => {
    if (!playing || !span) return;
    const step = 100;
    const timer = setInterval(() => {
      setT((cur) => {
        const next = (cur ?? span.a) + step * speed;
        if (next >= span.b) {
          setPlaying(false);
          return span.b;
        }
        return next;
      });
    }, step);
    return () => clearInterval(timer);
  }, [playing, speed, span]);

  const play = () => {
    tap();
    if (!span) return;
    if (playing) return setPlaying(false);
    if (t == null || t >= span.b) setT(span.a);
    setPlaying(true);
  };
  const pick = (uid: string) => {
    tap();
    setSel((cur) => (cur === uid ? null : uid));
  };

  return (
    <View style={{ flex: 1 }}>
      <TacticalMap
        baseLayer={baseLayer}
        self={null}
        follow={false}
        members={[]}
        selfId={null}
        teamColor={C.accent}
        ownerId={null}
        markers={[]}
        overlays={overlays}
        analysis={tracks ? analysis : null}
        replay={{ t, sel }}
        onReplayPick={pick}
      />

      <Glass radius={R.lg} style={styles.topCard}>
        <Text style={styles.itemTitle} numberOfLines={1}>
          {rec?.name ?? 'Запись'}
        </Text>
        <Text style={styles.sub}>
          {rec ? dateTime(rec.startedAt) : ''}
          {rec?.endedAt ? ` · ${formatDuration(rec.endedAt - rec.startedAt)}` : ''}
          {` · ${colored.length} бойцов`}
        </Text>
        <View style={styles.toggles}>
          <Toggle label="Тепловая карта" icon="fire" on={showHeat} onPress={() => setShowHeat(!showHeat)} />
          <Toggle label="Маршруты" icon="map-marker-path" on={showTracks} onPress={() => setShowTracks(!showTracks)} />
        </View>
      </Glass>

      <Glass radius={R.lg} style={styles.legend}>
        {!tracks ? (
          <ActivityIndicator color={C.accent} />
        ) : colored.length === 0 ? (
          <Text style={styles.sub}>
            {(tracks.length ? 'Бойцы не прислали ни одной точки. ' : 'Ни один телефон ещё не прислал маршрут. ') +
              'Точки копятся на телефонах и приходят, когда телефон выходит в интернет с открытым GrimMap. ' +
              'Чтобы маршрут писался с погасшим экраном, у бойцов должна быть включена «Работа в фоне».'}
          </Text>
        ) : (
          <>
            {span && (
              <Timeline
                span={span}
                t={t}
                playing={playing}
                speed={speed}
                onPlay={play}
                onSeek={(v) => {
                  setPlaying(false);
                  setT(v);
                }}
                onSpeed={setSpeed}
                onWhole={() => {
                  tap();
                  setPlaying(false);
                  setT(null);
                }}
              />
            )}
            <Text style={styles.pickHint}>
              {sel ? 'Путь выбранного бойца. Нажмите ещё раз, чтобы снова видеть всех.' : 'Нажмите на бойца — покажу его путь.'}
            </Text>
            <ScrollView style={{ maxHeight: 130 }}>
              {colored.map((tr) => (
                <Pressable
                  key={tr.uid}
                  onPress={() => pick(tr.uid)}
                  style={[styles.legendRow, sel === tr.uid && styles.legendSel, sel && sel !== tr.uid && { opacity: 0.5 }]}
                >
                  <View style={[styles.legendDot, { backgroundColor: tr.color }]} />
                  <Text style={styles.legendName} numberOfLines={1}>
                    {tr.callsign}
                  </Text>
                  <Text style={styles.legendStat}>
                    {formatDistance(tr.stats.distance)} · {formatDuration(tr.stats.duration)} · {tr.points.length} т.
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </>
        )}
      </Glass>
    </View>
  );
}

const SPEEDS = [10, 30, 60, 120];

/** Play / pause, the moment shown, a draggable bar, speed. */
function Timeline({
  span,
  t,
  playing,
  speed,
  onPlay,
  onSeek,
  onSpeed,
  onWhole,
}: {
  span: { a: number; b: number };
  t: number | null;
  playing: boolean;
  speed: number;
  onPlay: () => void;
  onSeek: (t: number) => void;
  onSpeed: (s: number) => void;
  onWhole: () => void;
}) {
  const [width, setWidth] = useState(1);
  const spanRef = useRef(span);
  spanRef.current = span;
  const widthRef = useRef(width);
  widthRef.current = width;
  const seekRef = useRef(onSeek);
  seekRef.current = onSeek;
  const responder = useMemo(() => {
    const at = (x: number) => {
      const s = spanRef.current;
      const k = Math.min(1, Math.max(0, x / widthRef.current));
      seekRef.current(s.a + k * (s.b - s.a));
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => at(e.nativeEvent.locationX),
      onPanResponderMove: (e) => at(e.nativeEvent.locationX),
      onPanResponderTerminationRequest: () => false,
    });
  }, []);
  const k = t == null ? 1 : (t - span.a) / (span.b - span.a);
  return (
    <View style={styles.timeline}>
      <View style={styles.tlRow}>
        <Pressable onPress={onPlay} style={styles.playBtn} accessibilityLabel={playing ? 'Пауза' : 'Воспроизвести'}>
          <Icon name={playing ? 'pause' : 'play'} size={22} color={C.accentInk} />
        </Pressable>
        <Text style={styles.tlTime}>{t == null ? 'вся игра' : `${formatClock(t)} · +${formatDuration(t - span.a)}`}</Text>
        {t != null && (
          <Pressable onPress={onWhole} hitSlop={8}>
            <Text style={styles.tlLink}>Вся игра</Text>
          </Pressable>
        )}
      </View>
      <View
        style={styles.tlBar}
        onLayout={(e) => setWidth(Math.max(1, e.nativeEvent.layout.width))}
        {...responder.panHandlers}
      >
        <View style={styles.tlTrack} pointerEvents="none" />
        <View style={[styles.tlFill, { width: `${Math.round(k * 100)}%` }]} pointerEvents="none" />
        <View style={[styles.tlKnob, { left: Math.max(0, Math.min(width - 18, k * width - 9)) }]} pointerEvents="none" />
      </View>
      <View style={styles.tlRow}>
        <Text style={styles.legendStat}>{formatClock(span.a)}</Text>
        <View style={{ flex: 1 }} />
        {SPEEDS.map((s) => (
          <Pressable
            key={s}
            onPress={() => {
              tap();
              onSpeed(s);
            }}
            style={[styles.speed, s === speed && styles.toggleOn]}
          >
            <Text style={[styles.speedText, s === speed && { color: C.accentInk }]}>×{s}</Text>
          </Pressable>
        ))}
        <View style={{ flex: 1 }} />
        <Text style={styles.legendStat}>{formatClock(span.b)}</Text>
      </View>
    </View>
  );
}

function Toggle({
  label,
  icon,
  on,
  onPress,
}: {
  label: string;
  icon: 'fire' | 'map-marker-path';
  on: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
      style={[styles.toggle, on && styles.toggleOn]}
    >
      <Icon name={icon} size={16} color={on ? C.accentInk : C.dim} />
      <Text style={[styles.toggleText, on && { color: C.accentInk }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10, paddingBottom: 48, width: '100%', maxWidth: 640, alignSelf: 'center' },
  hint: { color: C.dim, fontSize: 14, lineHeight: 20, fontFamily: F.regular, marginBottom: 6 },
  empty: { alignItems: 'center', gap: 10, paddingTop: 30 },
  emptyText: { color: C.faint, fontSize: 15, fontFamily: F.regular },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  itemIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: C.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemTitle: { color: C.text, fontSize: 16, fontFamily: F.bold },
  sub: { color: C.dim, fontSize: 13, fontFamily: F.regular, marginTop: 1 },
  topCard: { position: 'absolute', top: 12, left: 12, right: 12, padding: 12, gap: 8, maxWidth: 520 },
  toggles: { flexDirection: 'row', gap: 8 },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 34,
    borderRadius: R.pill,
    backgroundColor: C.elevated,
  },
  toggleOn: { backgroundColor: C.accent },
  toggleText: { color: C.dim, fontSize: 13, fontFamily: F.semibold },
  legend: { position: 'absolute', bottom: 16, left: 12, right: 12, padding: 12, maxWidth: 520 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  legendDot: { width: 12, height: 12, borderRadius: 6 },
  legendName: { color: C.text, fontSize: 14, fontFamily: F.semibold, flex: 1 },
  legendStat: { color: C.dim, fontSize: 12, fontFamily: F.mono },
  legendSel: { backgroundColor: C.accentSoft, borderRadius: R.sm, paddingHorizontal: 6 },
  pickHint: { color: C.faint, fontSize: 12, fontFamily: F.regular, marginVertical: 6 },
  timeline: { gap: 8 },
  tlRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  playBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  tlTime: { color: C.text, fontSize: 14, fontFamily: F.mono, flex: 1 },
  tlLink: { color: C.accent, fontSize: 13, fontFamily: F.semibold },
  tlBar: { height: 28, justifyContent: 'center' },
  tlTrack: { position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2, backgroundColor: C.elevated },
  tlFill: { position: 'absolute', left: 0, height: 4, borderRadius: 2, backgroundColor: C.accent },
  tlKnob: { position: 'absolute', width: 18, height: 18, borderRadius: 9, backgroundColor: C.text, borderWidth: 3, borderColor: C.accent },
  speed: { paddingHorizontal: 8, height: 26, borderRadius: R.pill, backgroundColor: C.elevated, justifyContent: 'center' },
  speedText: { color: C.dim, fontSize: 12, fontFamily: F.mono },
});
