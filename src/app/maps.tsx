import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import type { OverlayFormat } from '../lib/types';
import { useOverlays } from '../state/overlays';
import { Badge, Eyebrow, Icon, tap, type IconName } from '../ui/components';
import { C, F, R } from '../ui/theme';

const FORMAT_ICON: Record<OverlayFormat, IconName> = {
  kmz: 'folder-zip-outline',
  kml: 'vector-polygon',
  gpx: 'map-marker-path',
  geojson: 'code-json',
};

export default function MapsScreen() {
  const { overlays, importOverlay, removeOverlay, setVisible, requestFocus } = useOverlays();
  const [busy, setBusy] = useState(false);

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
          {overlays.length > 0 && <Eyebrow style={{ paddingHorizontal: 4 }}>Загруженные · {overlays.length}</Eyebrow>}
        </View>
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
              <Text style={styles.meta}>{new Date(item.addedAt).toLocaleDateString('ru-RU')}</Text>
            </View>
          </View>
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
              Alert.alert('Удалить карту?', item.name, [
                { text: 'Отмена', style: 'cancel' },
                { text: 'Удалить', style: 'destructive', onPress: () => removeOverlay(item.id) },
              ])
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
