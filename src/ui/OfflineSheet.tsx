import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { formatClock } from '../lib/geo';
import { TILE_LAYERS, type Bounds } from '../lib/tiles';
import { MAX_TOTAL_TILES, OFFLINE_SUPPORTED, planDownload } from '../services/offlineMaps';
import { REGIONS_SUPPORTED } from '../services/vectorRegions';
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
  const plan = b ? planDownload(layer, b, minZoom, maxZoom) : null;
  const tooBig = plan != null && !plan.fits;
  const pct = download && download.total ? Math.round((download.done / download.total) * 100) : 0;
  const size = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} ГБ` : `${mb} МБ`);

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
          {!OFFLINE_SUPPORTED
            ? 'Скачивание карт работает в приложении на телефоне.'
            : def
              ? `Участок: скачивается то, что сейчас на экране: ${def.title}.`
              : 'Сейчас включена «Схема офлайн»: она уже работает без интернета.'}
        </Text>
      </View>

      {REGIONS_SUPPORTED && (
        <Pressable
          onPress={() => {
            tap();
            onClose();
            router.push('/regions');
          }}
          style={({ pressed }) => [styles.regions, pressed && { opacity: 0.7 }]}
        >
          <Icon name="map-check-outline" size={24} color={C.accent} />
          <View style={{ flex: 1 }}>
            <Text style={styles.regionsTitle}>Регион целиком — схема</Text>
            <Text style={styles.sub}>Вся область без интернета: дороги, дома, леса. Сотни мегабайт, а не гигабайты.</Text>
          </View>
          <Icon name="chevron-right" size={22} color={C.faint} />
        </Pressable>
      )}

      {download ? (
        <View style={{ gap: 10 }}>
          <Eyebrow>
            Скачивание{download.parts > 1 ? ` · часть ${download.part} из ${download.parts}` : ''} · {pct}%
          </Eyebrow>
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
                {!plan
                  ? '…'
                  : tooBig
                    ? plan.tooMany
                      ? `Слишком большой район за один раз: ≈ ${size(plan.mb)}, ${Math.round(plan.tiles / 1000)} тыс. квадратиков карты (можно до ${MAX_TOTAL_TILES / 1000} тыс.). Приблизьте карту, выберите меньшую детализацию или скачайте район по частям.`
                      : `Не поместится на телефон: ≈ ${size(plan.mb)}, свободно ${size(plan.freeMb ?? 0)}. Приблизьте карту или выберите меньшую детализацию.`
                    : `≈ ${size(plan.mb)}${plan.parts.length > 1 ? `, скачается частями: ${plan.parts.length}` : ''}, масштабы ${minZoom}–${Math.min(maxZoom, def.maxZoom)}${plan.freeMb != null ? `. Свободно ${size(plan.freeMb)}` : ''}. Лучше качать по Wi-Fi.`}
              </Text>
            </View>
            <Button title="Скачать" icon="cloud-download-outline" disabled={!plan || tooBig || !plan.tiles} onPress={start} />
          </>
        )
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  regions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.lineStrong,
    backgroundColor: C.elevated,
  },
  regionsTitle: { color: C.text, fontFamily: F.semibold, fontSize: 16 },
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
