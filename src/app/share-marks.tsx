import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { encodeMarks } from '../lib/markShare';
import { plural } from '../lib/voice';
import type { TacMarker } from '../lib/types';
import { useSession } from '../state/session';
import { Button, Icon, KeyboardScroll } from '../ui/components';
import { QrCode } from '../ui/QrCode';
import { C, F } from '../ui/theme';

/** Game objects and photos stay behind: the first belong to a game, the second don't fit. */
const shareable = (m: TacMarker) => !['hotzone', 'flag', 'ball', 'sector', 'photo'].includes(m.kind);

/** Shows the map's markers and routes as a cycle of QR codes for another phone to scan. */
export default function ShareMarksScreen() {
  const s = useSession();
  const { width } = useWindowDimensions();
  const marks = useMemo(() => s.markers.filter(shareable), [s.markers]);
  // Named by content: squad updates that don't change the markers keep the same codes,
  // so a scan in progress isn't reset.
  const codes = useMemo(
    () => encodeMarks(marks.map((m) => ({ kind: m.kind, label: m.label, lat: m.lat, lng: m.lng, points: m.points, color: m.color }))),
    [marks]
  );
  const codesKey = codes.join('\n');
  const count = codes.length;
  const [i, setI] = useState(0);
  useEffect(() => {
    setI(0);
    if (count < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % count), 900);
    return () => clearInterval(t);
  }, [codesKey, count]);

  const size = Math.min(width - 48, 340);
  const routes = marks.filter((m) => m.points?.length).length;

  return (
    <KeyboardScroll contentContainerStyle={styles.scroll}>
      {marks.length === 0 ? (
        <View style={styles.empty}>
          <Icon name="map-marker-off-outline" size={44} color={C.faint} />
          <Text style={styles.dim}>На карте нет меток, которые можно передать.</Text>
        </View>
      ) : (
        <>
          <Text style={styles.title}>
            {marks.length - routes} {plural(marks.length - routes, 'метка', 'метки', 'меток')}
            {routes ? ` и ${routes} ${plural(routes, 'маршрут', 'маршрута', 'маршрутов')}` : ''}
          </Text>
          <View style={styles.qr}>
            <QrCode value={codes[Math.min(i, codes.length - 1)]} size={size} />
          </View>
          {codes.length > 1 && (
            <Text style={styles.part}>
              код {Math.min(i, codes.length - 1) + 1} из {codes.length} · меняется сам
            </Text>
          )}
          <Text style={styles.dim}>
            На втором телефоне: «Карты полигона» → «Метки по QR» → «Принять метки по QR». Держите камеру на этом экране, пока не
            соберутся все коды. Интернет не нужен. Фото и игровые объекты не передаются.
          </Text>
        </>
      )}
      <Button title="Принять метки по QR" icon="qrcode-scan" kind="secondary" onPress={() => router.push('/scan')} />
    </KeyboardScroll>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, gap: 14, alignItems: 'stretch' },
  empty: { alignItems: 'center', gap: 12, paddingVertical: 40 },
  title: { color: C.text, fontSize: 17, fontFamily: F.bold, textAlign: 'center' },
  qr: { alignItems: 'center' },
  part: { color: C.accent, fontSize: 14, fontFamily: F.mono, textAlign: 'center' },
  dim: { color: C.dim, fontSize: 14, fontFamily: F.regular, textAlign: 'center', lineHeight: 20 },
});
