import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  calendarAppLink,
  calendarWebLink,
  formatFromName,
  formatGameDate,
  POINT_LABEL,
  type CalendarGame,
} from '../lib/calendar';
import { distanceMeters } from '../lib/geo';
import { KEYS, loadJson } from '../lib/storage';
import { boundsAround, TILE_LAYERS } from '../lib/tiles';
import { fetchCalendarGame } from '../services/calendar';
import { useOverlays } from '../state/overlays';
import { useSession } from '../state/session';
import { Badge, Button, Card, Eyebrow, Icon } from '../ui/components';
import { C, F } from '../ui/theme';

const POINT_ICON = { respawn: 'flag-variant', deadzone: 'skull', parking: 'parking', admin: 'tent' } as const;
const AREA_KM = 2;
const MIN_ZOOM = 11;
const MAX_ZOOM = 17;

/**
 * Opened by grimmap://polygon?game=<id> from the THE GRIM TEAM calendar (or from the
 * calendar list on the maps screen): loads the game's polygon map and points, puts the
 * points on the map as personal markers and offers the area for offline use.
 */
export default function PolygonScreen() {
  const { game: gameId } = useLocalSearchParams<{ game?: string }>();
  const session = useSession();
  const { importOverlayFromUrl, requestView, downloadArea, download } = useOverlays();
  const [game, setGame] = useState<CalendarGame | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'' | 'show' | 'offline'>('');

  useEffect(() => {
    if (!gameId) return;
    fetchCalendarGame(String(gameId)).then(setGame, (e: Error) => setError(e.message));
  }, [gameId]);

  if (!gameId || error) {
    return (
      <View style={styles.center}>
        <Card style={{ gap: 12, alignItems: 'center' }}>
          <Icon name="map-marker-question-outline" size={40} color={C.dim} />
          <Text style={styles.text}>{error || 'Ссылка на игру не распознана.'}</Text>
          <Button title="К карте" kind="ghost" onPress={() => router.replace('/')} />
        </Card>
      </View>
    );
  }
  if (!game) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  const title = `Полигон · ${game.title}`.slice(0, 60);

  const addPoints = async () => {
    for (const p of game.points) {
      const dup = session.markers.some(
        (m) => m.personal && m.kind === p.kind && distanceMeters(m, p) < 5
      );
      if (!dup) await session.addMarker({ kind: p.kind, label: p.label || POINT_LABEL[p.kind], lat: p.lat, lng: p.lng }, 'personal');
    }
  };

  const show = async () => {
    setBusy('show');
    try {
      await addPoints();
      const format = formatFromName(game.mapName) ?? formatFromName(game.mapUrl);
      if (game.mapUrl && format) await importOverlayFromUrl(game.mapUrl, title, format);
      else if (game.center) requestView({ ...game.center, zoom: 15 });
      router.replace('/');
    } catch (e) {
      Alert.alert('Не удалось загрузить карту полигона', (e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const offline = async () => {
    if (!game.center) return;
    setBusy('offline');
    try {
      const layer = await loadJson<string>(KEYS.baseLayer, 'yandex-sat');
      await downloadArea(TILE_LAYERS[layer] ? layer : 'yandex-sat', title, boundsAround(game.center, AREA_KM), MIN_ZOOM, MAX_ZOOM);
      Alert.alert('Готово', 'Район полигона сохранён — карта будет работать без интернета.');
    } catch (e) {
      Alert.alert('Не удалось скачать район', (e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const openCalendar = () =>
    Linking.openURL(calendarAppLink(game.id)).catch(() => Linking.openURL(calendarWebLink(game.id)));

  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={styles.content}>
      <Card style={{ gap: 10 }}>
        <Eyebrow>Игра из календаря THE GRIM TEAM</Eyebrow>
        <Text style={styles.title}>{game.title}</Text>
        {!!formatGameDate(game.start) && <Text style={styles.meta}>{formatGameDate(game.start)}</Text>}
        {!!game.location && <Text style={styles.meta}>{game.location}</Text>}
        <View style={styles.badges}>
          {game.cancelled && <Badge text="ОТМЕНЕНА" color={C.danger} />}
          {!!game.mapUrl && <Badge text={`КАРТА ${(formatFromName(game.mapName) ?? formatFromName(game.mapUrl) ?? '').toUpperCase()}`} color={C.accent} />}
          {game.points.length > 0 && <Badge text={`ТОЧЕК: ${game.points.length}`} />}
        </View>
      </Card>

      {game.points.length > 0 && (
        <Card style={{ gap: 8 }}>
          <Eyebrow>Точки полигона</Eyebrow>
          {game.points.map((p, i) => (
            <View key={i} style={styles.point}>
              <Icon name={POINT_ICON[p.kind]} size={18} color={C.accent} />
              <Text style={styles.pointText}>
                {POINT_LABEL[p.kind]}
                {p.label ? ` · ${p.label}` : ''}
              </Text>
            </View>
          ))}
          <Text style={styles.hint}>Появятся на карте как ваши личные метки — их видите только вы.</Text>
        </Card>
      )}

      {!game.mapUrl && !game.center ? (
        <Card>
          <Text style={styles.text}>Организатор пока не добавил карту и координаты полигона.</Text>
        </Card>
      ) : (
        <Button title="Показать полигон на карте" icon="map-search-outline" busy={busy === 'show'} disabled={!!busy} onPress={show} />
      )}
      {!!game.center && (
        <Button
          title={download ? `Скачивание… ${download.total ? Math.round((download.done / download.total) * 100) : 0}%` : 'Скачать район для игры без интернета'}
          icon="download-outline"
          kind="ghost"
          busy={busy === 'offline'}
          disabled={!!busy || !!download}
          onPress={offline}
        />
      )}
      <Button title="Открыть игру в календаре" icon="calendar-month-outline" kind="ghost" onPress={openCalendar} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, padding: 16, justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg },
  content: { padding: 16, gap: 12, paddingBottom: 48, width: '100%', maxWidth: 640, alignSelf: 'center' },
  title: { color: C.text, fontSize: 22, fontFamily: F.bold },
  meta: { color: C.dim, fontSize: 14, fontFamily: F.mono },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  point: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  pointText: { color: C.text, fontSize: 15, fontFamily: F.regular },
  hint: { color: C.faint, fontSize: 12, fontFamily: F.regular, marginTop: 4 },
  text: { color: C.dim, fontSize: 15, lineHeight: 21, fontFamily: F.regular, textAlign: 'center' },
});
