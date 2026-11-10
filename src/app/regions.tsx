import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { RegionInfo } from '../services/vectorRegions';
import { useRegions, type LocalRegion } from '../state/regions';
import { confirmDestructive } from '../ui/confirm';
import { Button, Eyebrow, Icon, tap } from '../ui/components';
import { C, F, R } from '../ui/theme';

const size = (bytes: number) =>
  bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} ГБ` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} МБ`;

/** Offline schematic maps by region: pick, download, show on the map. */
export default function RegionsScreen() {
  const g = useRegions();
  const [query, setQuery] = useState('');
  const { refreshIndex } = g;
  useEffect(() => {
    if (g.supported) refreshIndex();
  }, [g.supported, refreshIndex]);

  const localById = useMemo(() => new Map(g.local.map((r) => [r.id, r])), [g.local]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Downloaded regions also show when the list can't be loaded (no internet).
    const all: (RegionInfo | LocalRegion)[] = g.index ?? g.local;
    return all
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .sort((a, b) => Number(localById.has(b.id)) - Number(localById.has(a.id)));
  }, [g.index, g.local, query, localById]);

  if (!g.supported) {
    return (
      <View style={styles.center}>
        <Text style={styles.sub}>Схемы регионов скачиваются в приложении на телефоне.</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: C.bg }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      data={rows}
      keyExtractor={(r) => r.id}
      ListHeaderComponent={
        <View style={{ gap: 14, marginBottom: 6 }}>
          <Text style={styles.sub}>
            Схема OpenStreetMap: дороги, дома, леса, реки и названия. Регион скачивается целиком и работает без
            интернета. На карте: слои → «Схема офлайн».
          </Text>
          {g.local.length > 0 && (
            <Button
              title="Показать схему на карте"
              icon="map-check-outline"
              onPress={() => {
                g.showOnMap();
                router.back();
              }}
            />
          )}
          <View style={styles.search}>
            <Icon name="magnify" size={20} color={C.dim} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Найти регион"
              placeholderTextColor={C.faint}
              style={styles.input}
              selectionColor={C.accent}
            />
          </View>
          {g.index == null && !g.indexError && <ActivityIndicator color={C.accent} />}
          {g.indexError && (
            <Pressable onPress={() => refreshIndex()} style={styles.error}>
              <Icon name="wifi-off" size={18} color={C.warn} />
              <Text style={[styles.sub, { flex: 1 }]}>{g.indexError}. Нажмите, чтобы повторить.</Text>
            </Pressable>
          )}
          <Eyebrow>{g.index ? 'Регионы' : 'Скачанные'}</Eyebrow>
        </View>
      }
      renderItem={({ item }) => {
        const mine = localById.get(item.id);
        const dl = g.downloads[item.id];
        const remote = 'url' in item ? item : g.index?.find((r) => r.id === item.id);
        const update = mine && remote && remote.build > mine.build;
        const pct = dl && dl.total ? Math.min(100, Math.round((dl.received / dl.total) * 100)) : 0;
        return (
          <View style={styles.row}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.meta}>
                {size(item.bytes)}
                {mine ? (update ? ' · есть обновление' : ' · скачан') : ''}
              </Text>
              {dl && (
                <View style={{ gap: 4, marginTop: 6 }}>
                  <View style={styles.bar}>
                    <View style={[styles.barFill, { width: `${pct}%` }]} />
                  </View>
                  <Text style={styles.meta}>
                    {dl.paused ? 'Пауза' : 'Скачивается'} · {pct}% · {size(dl.received)} из {size(dl.total)}
                  </Text>
                </View>
              )}
            </View>
            {dl ? (
              <View style={styles.actions}>
                <RoundButton
                  icon={dl.paused ? 'play' : 'pause'}
                  label={dl.paused ? 'Продолжить' : 'Пауза'}
                  onPress={() => (dl.paused ? g.resume(item.id) : g.pause(item.id))}
                />
                <RoundButton icon="close" label="Отменить" onPress={() => g.cancel(item.id)} />
              </View>
            ) : (
              <View style={styles.actions}>
                {remote && (!mine || update) && (
                  <RoundButton
                    icon={update ? 'update' : 'download'}
                    label={update ? 'Обновить' : 'Скачать'}
                    accent
                    onPress={() => g.download(remote)}
                  />
                )}
                {mine && (
                  <RoundButton
                    icon="trash-can-outline"
                    label="Удалить"
                    onPress={() =>
                      confirmDestructive(`Удалить «${item.name}»?`, 'Схема пропадёт с телефона.', 'Удалить', () =>
                        g.remove(item.id)
                      )
                    }
                  />
                )}
              </View>
            )}
          </View>
        );
      }}
      ListFooterComponent={
        <Text style={[styles.meta, { marginTop: 18 }]}>
          Данные © участники OpenStreetMap (ODbL), сборка Protomaps. Обновляются раз в месяц. Лучше качать по Wi-Fi.
        </Text>
      }
    />
  );
}

function RoundButton({
  icon,
  label,
  onPress,
  accent,
}: {
  icon: 'play' | 'pause' | 'close' | 'download' | 'update' | 'trash-can-outline';
  label: string;
  onPress: () => void;
  accent?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      hitSlop={6}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [styles.round, accent && styles.roundAccent, pressed && { opacity: 0.6 }]}
    >
      <Icon name={icon} size={22} color={accent ? C.accentInk : C.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: C.bg },
  sub: { color: C.dim, fontFamily: F.regular, fontSize: 14, lineHeight: 20 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.elevated,
  },
  input: { flex: 1, minHeight: 46, color: C.text, fontFamily: F.regular, fontSize: 16 },
  error: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.line,
  },
  name: { color: C.text, fontFamily: F.semibold, fontSize: 16 },
  meta: { color: C.dim, fontFamily: F.regular, fontSize: 13 },
  actions: { flexDirection: 'row', gap: 8 },
  round: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.lineStrong,
    backgroundColor: C.elevated,
  },
  roundAccent: { backgroundColor: C.accent, borderColor: C.accent },
  bar: { height: 6, borderRadius: 3, backgroundColor: C.elevated, overflow: 'hidden' },
  barFill: { height: 6, backgroundColor: C.accent },
});
