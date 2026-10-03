import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

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
        .filter((t) => t.points.length > 1)
        .map((t, i) => ({ ...t, color: TEAM_COLORS[i % TEAM_COLORS.length], stats: trackStats(t.points) })),
    [tracks]
  );

  const analysis = useMemo(
    () => ({
      tracks: colored.map((t) => ({
        color: t.color,
        segments: splitSegments(t.points).map((seg) => seg.map((p) => [p.lat, p.lng] as [number, number])),
      })),
      heat: colored.flatMap((t) => resampleByTime(t.points).map((p) => [p.lat, p.lng] as [number, number])),
      showHeat,
      showTracks,
    }),
    [colored, showHeat, showTracks]
  );

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
          <Text style={styles.sub}>В этой записи нет перемещений</Text>
        ) : (
          <ScrollView style={{ maxHeight: 150 }}>
            {colored.map((t) => (
              <View key={t.uid} style={styles.legendRow}>
                <View style={[styles.legendDot, { backgroundColor: t.color }]} />
                <Text style={styles.legendName} numberOfLines={1}>
                  {t.callsign}
                </Text>
                <Text style={styles.legendStat}>
                  {formatDistance(t.stats.distance)} · {formatDuration(t.stats.duration)}
                </Text>
              </View>
            ))}
          </ScrollView>
        )}
      </Glass>
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
});
