import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { formatClock } from '../lib/geo';
import { TILE_LAYERS, type Bounds } from '../lib/tiles';
import { estimate, MAX_TILES, OFFLINE_SUPPORTED } from '../services/offlineMaps';
import { useOverlays } from '../state/overlays';

import { Button, Eyebrow, Icon, Sheet, tap } from './components';
import { C, F, R } from './theme';

const DETAIL = [
  { maxZoom: 16, title: 'Обзор', sub: 'дороги, поля, лес' },
  { maxZoom: 17, title: 'Подробно', sub: 'здания, тропы' },
  { maxZoom: 18, title: 'Максимум', sub: 'отдельные кусты' },
];

/** Download the visible part of the current base layer for use without internet. */
export function OfflineSheet({
  visible,
  onClose,
  layer,
  view,
}: {
  visible: boolean;
  onClose: () => void;
  layer: string;
  view: { zoom: number; bounds?: Bounds } | null;
}) {
  const { download, downloadArea, cancelDownload } = useOverlays();
  const [detail, setDetail] = useState(1);
  const [name, setName] = useState('');
  useEffect(() => {
    if (visible) setName(`Район ${new Date().toLocaleDateString('ru-RU')} ${formatClock(Date.now())}`);
  }, [visible]);

  const def = TILE_LAYERS[layer];
  const b = view?.bounds;
  const minZoom = view ? Math.max(8, Math.min(13, Math.floor(view.zoom) - 2)) : 12;
  const maxZoom = DETAIL[detail].maxZoom;
  const est = b ? estimate(layer, b, minZoom, maxZoom) : { tiles: 0, mb: 0 };
  const tooBig = est.tiles > MAX_TILES;
  const pct = download && download.total ? Math.round((download.done / download.total) * 100) : 0;

  const start = () => {
    if (!b) return;
    downloadArea(layer, name.trim() || 'Район', b, minZoom, maxZoom)
      .then(() => Alert.alert('Карта скачана', 'Этот район теперь виден и без интернета.'))
      .catch((e: Error) => Alert.alert('Не удалось скачать', e.message));
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View>
        <Text style={styles.title}>Карта без интернета</Text>
        <Text style={styles.sub}>
          {OFFLINE_SUPPORTED
            ? `Скачивается то, что сейчас на экране: ${def?.title ?? 'подложка'}.`
            : 'Скачивание карт работает в приложении на телефоне.'}
        </Text>
      </View>

      {download ? (
        <View style={{ gap: 10 }}>
          <Eyebrow>Скачивание · {pct}%</Eyebrow>
          <View style={styles.bar}>
            <View style={[styles.barFill, { width: `${pct}%` }]} />
          </View>
          <Text style={styles.sub}>
            {download.done} из {download.total || '…'} тайлов. Можно свернуть окно: скачивание продолжится.
          </Text>
          <Button title="Остановить" kind="danger" icon="stop" onPress={cancelDownload} />
        </View>
      ) : (
        OFFLINE_SUPPORTED &&
        def && (
          <>
            <View style={{ gap: 8 }}>
              <Eyebrow>Детализация</Eyebrow>
              <View style={styles.row}>
                {DETAIL.map((d, i) => (
                  <Pressable
                    key={d.maxZoom}
                    onPress={() => {
                      tap();
                      setDetail(i);
                    }}
                    style={[styles.opt, i === detail && styles.optOn]}
                  >
                    <Text style={[styles.optTitle, i === detail && { color: C.accent }]}>{d.title}</Text>
                    <Text style={styles.optSub}>{d.sub}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Название района"
              placeholderTextColor={C.faint}
              maxLength={40}
              style={styles.input}
              selectionColor={C.accent}
            />
            <View style={styles.estimate}>
              <Icon name={tooBig ? 'alert' : 'database-arrow-down-outline'} size={20} color={tooBig ? C.warn : C.dim} />
              <Text style={[styles.sub, { flex: 1 }]}>
                {tooBig
                  ? `Слишком большой район: ${est.tiles} тайлов. Приблизьте карту или выберите меньшую детализацию.`
                  : `≈ ${est.mb} МБ, ${est.tiles} тайлов, масштабы ${minZoom}–${Math.min(maxZoom, def.maxZoom)}. Лучше качать по Wi-Fi.`}
              </Text>
            </View>
            <Button title="Скачать" icon="cloud-download-outline" disabled={!b || tooBig || !est.tiles} onPress={start} />
          </>
        )
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  title: { color: C.text, fontSize: 22, fontFamily: F.bold },
  sub: { color: C.dim, fontSize: 14, fontFamily: F.regular, marginTop: 2, lineHeight: 19 },
  row: { flexDirection: 'row', gap: 8 },
  opt: {
    flex: 1,
    padding: 10,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.elevated,
    gap: 2,
  },
  optOn: { borderColor: C.accent, backgroundColor: C.accentSoft },
  optTitle: { color: C.text, fontFamily: F.semibold, fontSize: 14 },
  optSub: { color: C.faint, fontFamily: F.regular, fontSize: 11 },
  input: {
    backgroundColor: C.elevated,
    color: C.text,
    borderRadius: R.md,
    paddingHorizontal: 14,
    height: 48,
    borderWidth: 1,
    borderColor: C.line,
    fontSize: 15,
    fontFamily: F.regular,
  },
  estimate: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  bar: { height: 8, borderRadius: 4, backgroundColor: C.elevated, overflow: 'hidden' },
  barFill: { height: 8, backgroundColor: C.accent },
});
