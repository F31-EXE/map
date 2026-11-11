import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';

import { parseInvite } from '../lib/invite';
import { MARKER_KINDS, isOrder } from '../lib/markerKinds';
import { isMarksCode, MarksCollector, type SharedMark } from '../lib/markShare';
import { distanceMeters } from '../lib/geo';
import type { MarkerKind } from '../lib/types';
import { useSession } from '../state/session';
import { useGame } from '../state/game';
import { Button, Icon } from '../ui/components';
import { C, F, R } from '../ui/theme';

/** Scans a squad or side invite QR and acts on it right away, or collects shared markers. */
export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const { acceptInvite } = useGame();
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const handled = useRef(false);
  const collector = useRef(new MarksCollector());
  const [progress, setProgress] = useState<{ got: number; total: number } | null>(null);

  const importMarks = async (marks: SharedMark[], scope: 'team' | 'personal') => {
    let added = 0;
    let skipped = 0;
    for (const m of marks) {
      const kind = m.kind as MarkerKind;
      if (!MARKER_KINDS[kind] || (scope === 'team' && isOrder(kind) && !session.canCommand)) {
        skipped++;
        continue;
      }
      // Already on the map (scanned twice, or the squad has it): skip.
      const dup = session.markers.some((x) => x.kind === kind && distanceMeters(x, m) < 3);
      if (dup) {
        skipped++;
        continue;
      }
      try {
        await session.addMarker(
          { kind, label: m.label, lat: m.lat, lng: m.lng, ...(m.points ? { points: m.points } : {}), ...(m.color ? { color: m.color } : {}) },
          scope
        );
        added++;
      } catch {
        skipped++;
      }
    }
    router.back();
    Alert.alert('Метки получены', `Добавлено: ${added}${skipped ? ` · пропущено: ${skipped} (уже есть или нельзя)` : ''}`);
  };

  const onMarks = (data: string) => {
    const r = collector.current.push(data);
    if (!r) return;
    setProgress({ got: r.got, total: r.total });
    if (!r.marks) return;
    handled.current = true;
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const marks = r.marks;
    const again = () => {
      handled.current = false;
      collector.current = new MarksCollector();
      setProgress(null);
    };
    Alert.alert(
      `Получено меток: ${marks.length}`,
      session.teamId ? 'Добавить их для всего отряда или только себе?' : 'Добавить их на вашу карту?',
      [
        { text: 'Отмена', style: 'cancel', onPress: () => router.back() },
        ...(session.teamId ? [{ text: 'Для отряда', onPress: () => importMarks(marks, 'team') }] : []),
        { text: session.teamId ? 'Только себе' : 'Добавить', onPress: () => importMarks(marks, 'personal') },
      ],
      { onDismiss: again }
    );
  };

  const onScanned = async (data: string) => {
    if (handled.current) return;
    if (isMarksCode(data)) {
      onMarks(data);
      return;
    }
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
        <Text style={styles.text}>Нужен доступ к камере, чтобы считать QR-код отряда, стороны или меток.</Text>
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
        <Text style={styles.hint}>
          {busy
            ? 'Подключаемся…'
            : progress
              ? `Метки: код ${progress.got} из ${progress.total} — держите камеру`
              : 'Наведите на QR-код отряда, стороны или меток'}
        </Text>
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
