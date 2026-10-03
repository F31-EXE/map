import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { useOverlays } from '../state/overlays';
import { Button } from '../ui/components';
import { C } from '../ui/theme';

export default function MapsScreen() {
  const { overlays, importOverlay, removeOverlay, setVisible, requestFocus } = useOverlays();
  const [busy, setBusy] = useState(false);

  const onImport = async () => {
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
    <View style={styles.root}>
      <Text style={styles.hint}>
        Загрузите карту полигона: KMZ (в т.ч. растровые Garmin Custom Maps), KML, GPX или GeoJSON. Карта
        сохраняется на телефоне и работает без интернета.
      </Text>
      <Button title="Загрузить файл карты" onPress={onImport} busy={busy} />
      <FlatList
        data={overlays}
        keyExtractor={(o) => o.id}
        contentContainerStyle={{ gap: 10, paddingVertical: 14 }}
        ListEmptyComponent={<Text style={styles.empty}>Пока нет загруженных карт</Text>}
        renderItem={({ item }) => (
          <View style={styles.item}>
            <Pressable
              style={{ flex: 1 }}
              onPress={() => {
                if (!item.visible) setVisible(item.id, true);
                requestFocus(item.id);
                router.back();
              }}
            >
              <Text style={styles.name} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.sub}>{item.format.toUpperCase()} · нажмите, чтобы показать</Text>
            </Pressable>
            <Switch
              value={item.visible}
              onValueChange={(v) => setVisible(item.id, v)}
              trackColor={{ true: C.accent }}
            />
            <Pressable
              hitSlop={8}
              onPress={() =>
                Alert.alert('Удалить карту?', item.name, [
                  { text: 'Отмена', style: 'cancel' },
                  { text: 'Удалить', style: 'destructive', onPress: () => removeOverlay(item.id) },
                ])
              }
            >
              <Text style={styles.delete}>✕</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, gap: 14 },
  hint: { color: C.muted, fontSize: 14, lineHeight: 20 },
  empty: { color: C.muted, textAlign: 'center', marginTop: 24 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  name: { color: C.text, fontSize: 16, fontWeight: '600' },
  sub: { color: C.muted, fontSize: 12, marginTop: 2 },
  delete: { color: C.danger, fontSize: 20, paddingHorizontal: 4 },
});
