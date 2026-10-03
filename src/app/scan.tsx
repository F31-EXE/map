import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';

import { parseInvite } from '../lib/invite';
import { useSide } from '../state/side';
import { Button, Icon } from '../ui/components';
import { C, F, R } from '../ui/theme';

/** Scans a squad or side invite QR and acts on it right away. */
export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const { acceptInvite } = useSide();
  const [busy, setBusy] = useState(false);
  const handled = useRef(false);

  const onScanned = async (data: string) => {
    if (handled.current) return;
    const invite = parseInvite(data);
    if (!invite) return; // Some other QR in view — keep looking.
    handled.current = true;
    setBusy(true);
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    try {
      const message = await acceptInvite(invite);
      router.back();
      Alert.alert('Готово', message);
    } catch (e) {
      Alert.alert('Не получилось', (e as Error).message, [
        { text: 'Ещё раз', onPress: () => (handled.current = false) },
        { text: 'Закрыть', onPress: () => router.back() },
      ]);
    } finally {
      setBusy(false);
    }
  };

  if (!permission) return <View style={styles.root} />;

  if (!permission.granted) {
    return (
      <View style={[styles.root, styles.center]}>
        <Icon name="camera-off-outline" size={48} color={C.dim} />
        <Text style={styles.text}>Нужен доступ к камере, чтобы считать QR-код отряда или стороны.</Text>
        <Button title="Разрешить камеру" icon="camera" onPress={requestPermission} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={busy ? undefined : (r) => onScanned(r.data)}
      />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>
        <View style={styles.frame} />
        <Text style={styles.hint}>{busy ? 'Подключаемся…' : 'Наведите на QR-код отряда или стороны'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 18, padding: 24 },
  text: { color: C.dim, fontSize: 15, fontFamily: F.regular, textAlign: 'center', lineHeight: 21 },
  frame: { width: 240, height: 240, borderRadius: R.lg, borderWidth: 3, borderColor: C.accent },
  hint: {
    color: C.text,
    fontFamily: F.semibold,
    fontSize: 15,
    backgroundColor: C.glassStrong,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: R.pill,
    overflow: 'hidden',
  },
});
