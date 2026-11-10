import * as Updates from 'expo-updates';
import { useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';

import { formatClock } from '../lib/geo';

import { Button, Card, Icon } from './components';
import { C, F } from './theme';

/**
 * Over-the-air updates (EAS Update): the app checks at launch and downloads in the
 * background; a downloaded update starts on the next launch, or now from here.
 */
export function UpdatesCard() {
  const u = Updates.useUpdates();
  const [checking, setChecking] = useState(false);
  if (Platform.OS === 'web' || !Updates.isEnabled) return null;

  const at = u.currentlyRunning.createdAt;
  const running = u.currentlyRunning.isEmbeddedLaunch
    ? 'встроенная версия'
    : `обновление от ${at ? `${at.toLocaleDateString('ru-RU')} ${formatClock(at.getTime())}` : '—'}`;

  const check = async () => {
    setChecking(true);
    try {
      const r = await Updates.checkForUpdateAsync();
      if (!r.isAvailable) {
        Alert.alert('Обновлений нет', 'У вас последняя версия.');
        return;
      }
      await Updates.fetchUpdateAsync();
    } catch (e) {
      Alert.alert('Не удалось проверить', (e as Error).message || 'Нет интернета');
    } finally {
      setChecking(false);
    }
  };

  return (
    <Card style={{ gap: 10 }}>
      <View style={styles.head}>
        <Icon name="cloud-download-outline" size={20} color={C.accent} />
        <Text style={styles.title}>Обновление</Text>
      </View>
      <Text style={styles.sub}>
        Сейчас: {running}. Новые версии приходят сами, без переустановки: скачиваются при запуске и включаются при
        следующем.
      </Text>
      {u.isUpdatePending ? (
        <Button title="Перезапустить с обновлением" icon="restart" onPress={() => Updates.reloadAsync()} />
      ) : (
        <Button
          title={u.isDownloading ? 'Скачиваю обновление…' : 'Проверить обновления'}
          icon="refresh"
          kind="secondary"
          busy={checking || u.isDownloading}
          onPress={check}
        />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: C.text, fontFamily: F.semibold, fontSize: 16 },
  sub: { color: C.dim, fontFamily: F.regular, fontSize: 13, lineHeight: 18 },
});
