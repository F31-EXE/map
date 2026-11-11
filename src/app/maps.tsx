import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { formatGameDate, type CalendarGame } from '../lib/calendar';
import type { OverlayFormat } from '../lib/types';
import { fetchUpcomingGames } from '../services/calendar';
import { TILE_LAYERS } from '../lib/tiles';
import { useOverlays } from '../state/overlays';
import { useSession } from '../state/session';
import { confirmAction, confirmDestructive } from '../ui/confirm';
import { Badge, Eyebrow, Icon, tap, type IconName } from '../ui/components';
import { C, F, R } from '../ui/theme';

const FORMAT_ICON: Record<OverlayFormat, IconName> = {
  kmz: 'folder-zip-outline',
  kml: 'vector-polygon',
  gpx: 'map-marker-path',
  geojson: 'code-json',
};

export default function MapsScreen() {
  const {
    overlays,
    importOverlay,
    removeOverlay,
    setVisible,
    requestFocus,
    areas,
    download,
    removeArea,
    sharedMaps,
    shareOverlay,
    unshareMap,
    fetchShared,
  } = useOverlays();
  const session = useSession();
  const inTeam = Boolean(session.teamId && session.uid);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState<string | null>(null);

  const share = (id: string, name: string) =>
    confirmAction('Отправить карту отряду?', `«${name}» появится у всех бойцов отряда.`, 'Отправить', async () => {
      setSending(id);
      try {
        await shareOverlay(id);
      } catch (e) {
        Alert.alert('Не удалось отправить', (e as Error).message);
      } finally {
        setSending(null);
      }
    });
  // Ближайшие игры из календаря THE GRIM TEAM, у которых есть карта или координаты
  const [games, setGames] = useState<CalendarGame[]>([]);
  useEffect(() => {
    fetchUpcomingGames().then((g) => setGames(g.slice(0, 5)), () => {});
  }, []);

  const onImport = async () => {
    tap();
    setBusy(true);
    try {
      const meta = await importOverlay();
      if (meta) router.back();
    } catch (e) {
      Alert.alert('Не удалось загрузить карту', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FlatList
      style={{ backgroundColor: C.bg }}
      contentContainerStyle={styles.content}
      data={overlays}
      keyExtractor={(o) => o.id}
      ListHeaderComponent={
        <View style={{ gap: 18 }}>
          <Pressable
            onPress={onImport}
            disabled={busy}
            style={({ pressed }) => [styles.drop, pressed && { backgroundColor: C.accentSoft }]}
          >
            <View style={styles.dropIcon}>
              {busy ? <ActivityIndicator color={C.accentInk} /> : <Icon name="tray-arrow-up" size={28} color={C.accentInk} />}
            </View>
            <Text style={styles.dropTitle}>Загрузить карту полигона</Text>
            <Text style={styles.dropSub}>KMZ · KML · GPX · GeoJSON</Text>
            <Text style={styles.dropHint}>
              Подойдут растровые карты из Google Earth и Garmin Custom Maps. Файл сохраняется на телефоне и
              работает без интернета.
            </Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.item, pressed && { borderColor: C.lineStrong }]}
            onPress={() => {
              tap();
              router.push('/share-marks');
            }}
          >
            <View style={styles.itemIcon}>
              <Icon name="qrcode" size={22} color={C.accent} />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.name}>Метки по QR</Text>
              <Text style={styles.meta} numberOfLines={1}>
                Передать или принять метки и маршруты без интернета
              </Text>
            </View>
            <Icon name="chevron-right" size={22} color={C.dim} />
          </Pressable>
          {games.length > 0 && (
            <View style={{ gap: 10 }}>
              <Eyebrow style={{ paddingHorizontal: 4 }}>Ближайшие игры · календарь THE GRIM TEAM</Eyebrow>
              {games.map((g) => (
                <Pressable
                  key={g.id}
                  style={({ pressed }) => [styles.item, pressed && { borderColor: C.lineStrong }]}
                  onPress={() => {
                    tap();
                    router.push({ pathname: '/polygon', params: { game: g.id } });
                  }}
                >
                  <View style={styles.itemIcon}>
                    <Icon name={g.mapUrl ? 'map-legend' : 'map-marker-radius-outline'} size={22} color={C.accent} />
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={styles.name} numberOfLines={1}>
                      {g.title}
                    </Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      {formatGameDate(g.start)}
                      {g.mapUrl ? ' · карта полигона' : ''}
                      {g.points.length ? ` · точек ${g.points.length}` : ''}
                    </Text>
                  </View>
                  <Icon name="chevron-right" size={22} color={C.dim} />
                </Pressable>
              ))}
            </View>
          )}
          {inTeam && sharedMaps.length > 0 && (
            <View style={{ gap: 10 }}>
              <Eyebrow style={{ paddingHorizontal: 4 }}>Карты отряда · {sharedMaps.length}</Eyebrow>
              {sharedMaps.map((m) => {
                const local = overlays.some((o) => o.sharedId === m.id);
                const mine = m.createdBy === session.uid;
                return (
                  <View key={m.id} style={styles.item}>
                    <View style={[styles.itemIcon, local && { backgroundColor: C.accentSoft }]}>
                      <Icon name="account-group" size={22} color={local ? C.accent : C.dim} />
                    </View>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={styles.name} numberOfLines={1}>
                        {m.name}
                      </Text>
                      <Text style={styles.meta} numberOfLines={1}>
                        {m.createdByName} · {Math.max(1, Math.round(m.size / 1024))} КБ ·{' '}
                        {local ? 'на телефоне' : 'не скачана'}
                      </Text>
                    </View>
                    {!local && (
                      <Pressable
                        hitSlop={8}
                        style={styles.delete}
                        accessibilityLabel="Скачать карту"
                        onPress={() => fetchShared(m).catch((e: Error) => Alert.alert('Не скачалась', e.message))}
                      >
                        <Icon name="cloud-download-outline" size={20} color={C.accent} />
                      </Pressable>
                    )}
                    {(mine || session.canCommand) && (
                      <Pressable
                        hitSlop={8}
                        style={styles.delete}
                        accessibilityLabel="Убрать у отряда"
                        onPress={() =>
                          confirmDestructive(
                            'Убрать карту у отряда?',
                            `«${m.name}» больше не будет приходить бойцам. У кого она уже скачана, останется.`,
                            'Убрать',
                            () => unshareMap(m).catch((e: Error) => Alert.alert('Не получилось', e.message))
                          )
                        }
                      >
                        <Icon name="account-remove-outline" size={20} color={C.dim} />
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
          )}
          {overlays.length > 0 && <Eyebrow style={{ paddingHorizontal: 4 }}>Загруженные · {overlays.length}</Eyebrow>}
        </View>
      }
      ListFooterComponent={
        areas.length > 0 ? (
          <View style={{ gap: 10, marginTop: 18 }}>
            <Eyebrow style={{ paddingHorizontal: 4 }}>Скачанные районы · без интернета</Eyebrow>
            {areas.map((a) => (
              <View key={a.id} style={styles.item}>
                <View style={[styles.itemIcon, a.complete && { backgroundColor: C.accentSoft }]}>
                  <Icon
                    name={download?.areaId === a.id ? 'cloud-sync-outline' : 'cloud-check-outline'}
                    size={22}
                    color={a.complete ? C.accent : C.warn}
                  />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.name} numberOfLines={1}>
                    {a.name}
                  </Text>
                  <Text style={styles.meta}>
                    {TILE_LAYERS[a.layer]?.title ?? a.layer} · {Math.max(1, Math.round(a.bytes / 1048576))} МБ ·{' '}
                    {download?.areaId === a.id
                      ? 'скачивается…'
                      : a.complete
                        ? `масштабы ${a.minZoom}–${a.maxZoom}`
                        : `скачано не полностью${a.failed ? `, ошибок ${a.failed}` : ''}`}
                  </Text>
                </View>
                {download?.areaId !== a.id && (
                  <Pressable
                    hitSlop={8}
                    style={styles.delete}
                    accessibilityLabel="Удалить район"
                    onPress={() =>
                      confirmDestructive('Удалить скачанный район?', a.name, 'Удалить', () => removeArea(a.id))
                    }
                  >
                    <Icon name="trash-can-outline" size={20} color={C.dim} />
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        ) : null
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Icon name="map-search-outline" size={40} color={C.faint} />
          <Text style={styles.emptyText}>Пока нет загруженных карт</Text>
        </View>
      }
      renderItem={({ item }) => (
        <Pressable
          style={({ pressed }) => [styles.item, !item.visible && { opacity: 0.6 }, pressed && { borderColor: C.lineStrong }]}
          onPress={() => {
            tap();
            if (!item.visible) setVisible(item.id, true);
            requestFocus(item.id);
            router.back();
          }}
        >
          <View style={[styles.itemIcon, item.visible && { backgroundColor: C.accentSoft }]}>
            <Icon name={FORMAT_ICON[item.format]} size={22} color={item.visible ? C.accent : C.dim} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.name} numberOfLines={1}>
              {item.name}
            </Text>
            <View style={styles.metaRow}>
              <Badge text={item.format.toUpperCase()} />
              {item.sharedId && <Badge text="ОТРЯД" color={C.accent} />}
              <Text style={styles.meta}>{new Date(item.addedAt).toLocaleDateString('ru-RU')}</Text>
            </View>
          </View>
          {inTeam && !item.sharedId && (
            <Pressable
              hitSlop={8}
              style={styles.delete}
              accessibilityLabel="Отправить отряду"
              disabled={sending != null}
              onPress={() => share(item.id, item.name)}
            >
              {sending === item.id ? (
                <ActivityIndicator color={C.accent} />
              ) : (
                <Icon name="share-variant-outline" size={20} color={C.accent} />
              )}
            </Pressable>
          )}
          <Switch
            value={item.visible}
            onValueChange={(v) => setVisible(item.id, v)}
            trackColor={{ true: C.accent, false: C.elevated }}
            thumbColor="#fff"
          />
          <Pressable
            hitSlop={8}
            style={styles.delete}
            onPress={() =>
              confirmDestructive('Удалить карту?', item.name, 'Удалить', () => removeOverlay(item.id))
            }
          >
            <Icon name="trash-can-outline" size={20} color={C.dim} />
          </Pressable>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10, paddingBottom: 48, width: '100%', maxWidth: 640, alignSelf: 'center' },
  drop: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: 28,
    paddingHorizontal: 20,
    borderRadius: R.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: C.accent + '66',
    backgroundColor: C.surface,
  },
  dropIcon: {
    width: 60,
    height: 60,
    borderRadius: 20,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  dropTitle: { color: C.text, fontSize: 18, fontFamily: F.bold },
  dropSub: { color: C.accent, fontSize: 13, fontFamily: F.mono, letterSpacing: 0.5 },
  dropHint: { color: C.dim, fontSize: 13, fontFamily: F.regular, textAlign: 'center', lineHeight: 19, marginTop: 4 },
  empty: { alignItems: 'center', gap: 10, paddingTop: 24 },
  emptyText: { color: C.faint, fontSize: 15, fontFamily: F.regular },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.surface,
    borderRadius: R.lg,
    padding: 12,
    borderWidth: 1,
    borderColor: C.line,
  },
  itemIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: C.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { color: C.text, fontSize: 16, fontFamily: F.semibold },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  meta: { color: C.faint, fontSize: 12, fontFamily: F.regular },
  delete: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
