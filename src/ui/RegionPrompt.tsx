import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { KEYS, loadJson, saveJson } from '../lib/storage';
import { boundsAround, TILE_LAYERS } from '../lib/tiles';
import type { LatLng } from '../lib/types';
import { listAreas, OFFLINE_SUPPORTED, planDownload } from '../services/offlineMaps';
import { useOverlays } from '../state/overlays';

import { Button, Eyebrow, Icon, Sheet, tap } from './components';
import { C, F, R } from './theme';

const RADII_KM = [1, 3, 5, 10];
const DETAIL = [
  { maxZoom: 16, title: 'Обзор', sub: 'дороги, поля, лес' },
  { maxZoom: 17, title: 'Подробно', sub: 'здания, тропы' },
];
const MIN_ZOOM = 11;

/**
 * First launch: offers to download the map around the player right away, so the
 * area is there at the field even without internet. Asked once.
 */
export function RegionPrompt({ position, layer }: { position: LatLng | null; layer: string }) {
  const { downloadArea, download } = useOverlays();
  // null until we know whether to ask.
  const [wanted, setWanted] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [km, setKm] = useState(3);
  const [detail, setDetail] = useState(1);
  const [at, setAt] = useState<LatLng | null>(null);

  useEffect(() => {
    if (!OFFLINE_SUPPORTED) return;
    Promise.all([loadJson<boolean>(KEYS.regionPrompted, false), listAreas()])
      .then(([asked, areas]) => setWanted(!asked && areas.length === 0))
      .catch(() => setWanted(false));
  }, []);

  // Ask once we know where the player is.
  useEffect(() => {
    if (wanted && position && !at) {
      setAt({ lat: position.lat, lng: position.lng });
      setOpen(true);
    }
  }, [wanted, position, at]);

  const done = () => {
    setOpen(false);
    setWanted(false);
    saveJson(KEYS.regionPrompted, true).catch(() => {});
  };

  // Base layers without downloadable tiles (shouldn't happen) fall back to Yandex satellite.
  const layerId = TILE_LAYERS[layer] ? layer : 'yandex-sat';
  const def = TILE_LAYERS[layerId];
  const maxZoom = DETAIL[detail].maxZoom;
  const plan = at ? planDownload(layerId, boundsAround(at, km), MIN_ZOOM, maxZoom) : null;
  const size = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} ГБ` : `${mb} МБ`);

  const start = () => {
    if (!at || !plan?.fits) return;
    done();
    downloadArea(layerId, `Мой район (${km} км)`, boundsAround(at, km), MIN_ZOOM, maxZoom)
      .then(() => Alert.alert('Карта района скачана', 'Она откроется и без интернета.'))
      .catch((e: Error) => Alert.alert('Не удалось скачать карту', e.message));
  };

  if (!open || download) return null;

  return (
    <Sheet visible={open} onClose={done}>
      <View>
        <Text style={styles.title}>Скачать карту района?</Text>
        <Text style={styles.sub}>
          На полигоне часто нет связи. Скачайте карту «{def.title}» вокруг себя сейчас, и она будет видна без
          интернета.
        </Text>
      </View>

      <View style={{ gap: 8 }}>
        <Eyebrow>Радиус вокруг вас</Eyebrow>
        <View style={styles.row}>
          {RADII_KM.map((r) => (
            <Pressable
              key={r}
              onPress={() => {
                tap();
                setKm(r);
              }}
              style={[styles.opt, r === km && styles.optOn]}
            >
              <Text style={[styles.optTitle, r === km && { color: C.accent }]}>{r} км</Text>
            </Pressable>
          ))}
        </View>
      </View>

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

      {plan && (
        <View style={styles.estimate}>
          <Icon name={plan.fits ? 'database-arrow-down-outline' : 'alert'} size={20} color={plan.fits ? C.dim : C.warn} />
          <Text style={[styles.sub, { flex: 1, marginTop: 0 }]}>
            {plan.fits
              ? `≈ ${size(plan.mb)}${plan.freeMb != null ? `, свободно ${size(plan.freeMb)}` : ''}. Лучше качать по Wi-Fi.`
              : 'Не поместится на телефон: выберите радиус поменьше.'}
          </Text>
        </View>
      )}

      <View style={styles.row}>
        <Button title="Позже" kind="secondary" onPress={done} style={{ flex: 1 }} />
        <Button
          title="Скачать"
          icon="cloud-download-outline"
          disabled={!plan?.fits}
          onPress={start}
          style={{ flex: 1.4 }}
        />
      </View>
      <Text style={styles.hint}>Другие районы — кнопка с облаком на карте.</Text>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  title: { color: C.text, fontSize: 22, fontFamily: F.bold },
  sub: { color: C.dim, fontSize: 14, fontFamily: F.regular, marginTop: 4, lineHeight: 19 },
  hint: { color: C.faint, fontSize: 12, fontFamily: F.regular, textAlign: 'center' },
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
  estimate: { flexDirection: 'row', gap: 10, alignItems: 'center' },
});
