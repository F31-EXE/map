import { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { timeAgo } from '../lib/geo';
import { nodeIdText } from '../lib/meshtastic';
import { pickRadio, type RadioDevice } from '../services/meshRadio';
import { GPS_MODES, type GpsMode } from '../lib/gpsSource';
import { setGpsMode, useGpsMode } from '../state/gpsSource';
import type { Radio } from '../state/useRadio';

import { Button, Card, Eyebrow, Icon, Sheet, tap } from './components';
import { confirmAction, confirmDestructive } from './confirm';
import { C, F, R } from './theme';

function statusText(r: Radio, inTeam: boolean, peers: number): { text: string; color: string } {
  if (r.state === 'connecting') return { text: 'Подключаюсь к рации…', color: C.warn };
  if (r.state === 'syncing') return { text: 'Читаю настройки рации…', color: C.warn };
  if (r.state === 'off') return { text: r.error ? `Нет связи с рацией: ${r.error}` : 'Рация не на связи, жду её', color: C.danger };
  if (!inTeam) return { text: 'Рация на связи. Вступите в отряд, чтобы передавать данные', color: C.warn };
  if (r.squadReady) return { text: `Канал отряда работает · слышно бойцов: ${peers}`, color: C.online };
  if (r.slotTaken) return { text: `Слот канала занят каналом «${r.slotTaken}»`, color: C.warn };
  return { text: 'Настраиваю канал отряда…', color: C.warn };
}

/** Settings card: pick a Meshtastic radio, see the link and the radios around. */
export function RadioCard({ radio, inTeam, peers }: { radio: Radio; inTeam: boolean; peers: number }) {
  const [picking, setPicking] = useState(false);

  if (!radio.supported) {
    return (
      <Card style={{ gap: 8 }}>
        <Header />
        <Text style={styles.sub}>
          Связь через LoRa-рации Meshtastic (Heltec V3, Heltec T114 и другие) на километры без интернета. Работает в
          приложении для Android и iPhone и на компьютере в Chrome или Edge (Bluetooth или USB-кабель).
        </Text>
      </Card>
    );
  }

  const st = statusText(radio, inTeam, peers);
  return (
    <Card style={{ gap: 12 }}>
      <Header />
      {radio.device ? (
        <>
          <View style={styles.deviceRow}>
            <Icon name="radio-handheld" size={22} color={st.color} />
            <View style={{ flex: 1 }}>
              <Text style={styles.device} numberOfLines={1}>
                {radio.device.name}
                {radio.myNode != null ? `  ${nodeIdText(radio.myNode)}` : ''}
              </Text>
              <Text style={[styles.sub, { color: st.color }]}>{st.text}</Text>
            </View>
          </View>
          {radio.slotTaken && inTeam && (
            <Button
              title="Занять слот каналом отряда"
              icon="swap-horizontal"
              kind="secondary"
              onPress={() =>
                confirmDestructive(
                  'Заменить канал на рации?',
                  `Во втором слоте рации сейчас канал «${radio.slotTaken}». GrimMap запишет туда закрытый канал отряда. Основной канал рации не меняется.`,
                  'Заменить',
                  () => radio.setupSquadChannel().catch((e: Error) => Alert.alert('Не получилось', e.message))
                )
              }
            />
          )}
          <GpsSourceBlock radio={radio} />
          {radio.nodes.length > 0 && (
            <View style={{ gap: 6 }}>
              <Eyebrow>Рации в эфире · {radio.nodes.length}</Eyebrow>
              {radio.nodes.slice(0, 8).map((n) => (
                <View key={n.num} style={styles.node}>
                  <Text style={styles.nodeName} numberOfLines={1}>
                    {n.longName || n.shortName || nodeIdText(n.num)}
                  </Text>
                  <Text style={styles.nodeSub}>{n.lastHeard ? timeAgo(n.lastHeard * 1000) : '—'}</Text>
                </View>
              ))}
            </View>
          )}
          <View style={styles.row}>
            {!WEB && <Button title="Другая рация" kind="secondary" style={{ flex: 1 }} onPress={() => setPicking(true)} />}
            <Button
              title="Отключить"
              kind="secondary"
              style={{ flex: 1 }}
              onPress={() => {
                tap();
                radio.forget();
              }}
            />
          </View>
          {WEB && <WebPick radio={radio} />}
        </>
      ) : (
        <>
          <Text style={styles.sub}>
            Позиции, чат, метки и приказы через LoRa-рацию: километры без интернета и сотовой связи. Рации отряда
            сами настроят закрытый канал, ключ общий для отряда.
          </Text>
          {WEB ? <WebPick radio={radio} /> : <Button title="Найти рацию" icon="bluetooth-connect" onPress={() => setPicking(true)} />}
        </>
      )}
      <RadioPicker
        visible={picking}
        radio={radio}
        onClose={() => setPicking(false)}
        onPick={(d) => {
          setPicking(false);
          radio.choose(d);
        }}
      />
    </Card>
  );
}

const WEB = Platform.OS === 'web';

/**
 * «Источник координат»: the phone's GPS, the radio's (often a better antenna), or
 * whichever is more accurate. The radio's position is read over Bluetooth every few
 * seconds; nothing extra goes on air. Fast radio GPS needs a settings change (reboot).
 */
function GpsSourceBlock({ radio }: { radio: Radio }) {
  const mode = useGpsMode();
  const g = radio.gps;
  const fix = radio.myPosition;
  const [, setNow] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const pick = (m: GpsMode) => {
    tap();
    setGpsMode(m);
    if (m !== 'phone' && radio.state === 'ready' && g.hasGps && !g.fast) askSpeedUp(radio);
  };

  let status: string;
  if (g.hasGps === false) status = 'У этой рации GPS выключен или его нет: координаты берутся с телефона.';
  else if (!fix) status = mode === 'phone' ? 'GPS рации используется, только если у телефона нет сигнала.' : 'Жду позицию от GPS рации…';
  else {
    const age = Date.now() - fix.at;
    const parts = [
      `GPS рации: ${fix.accuracy != null ? `±${Math.round(fix.accuracy)} м` : 'точность неизвестна'}`,
      fix.sats != null ? `спутников ${fix.sats}` : null,
      age < 60_000 ? 'фикс свежий' : `фикс ${timeAgo(fix.at)}`,
    ];
    status = parts.filter(Boolean).join(' · ');
  }

  return (
    <View style={{ gap: 8 }}>
      <Eyebrow>Источник координат</Eyebrow>
      <View style={styles.row}>
        {GPS_MODES.map((m) => (
          <Pressable
            key={m.id}
            onPress={() => pick(m.id)}
            style={[styles.chip, mode === m.id && styles.chipOn]}
            disabled={m.id !== 'phone' && g.hasGps === false}
          >
            <Text style={[styles.chipText, mode === m.id && { color: C.accentInk }, m.id !== 'phone' && g.hasGps === false && { opacity: 0.4 }]}>
              {m.title}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.sub}>
        {mode === 'phone'
          ? 'GPS телефона.'
          : mode === 'radio'
            ? 'GPS рации (выносная антенна ловит лучше в лесу и в кармане); без её сигнала — GPS телефона.'
            : 'Точнее из двух: GPS телефона или рации.'}{' '}
        {status}
      </Text>
      {mode !== 'phone' && g.hasGps && !g.fast && radio.state === 'ready' && (
        <Button title="Ускорить GPS рации" icon="crosshairs-gps" kind="secondary" onPress={() => askSpeedUp(radio)} />
      )}
      {g.canRestore && (
        <Button
          title="Вернуть рации обычный GPS"
          icon="battery-heart-variant"
          kind="ghost"
          onPress={() =>
            confirmAction(
              'Вернуть настройки GPS рации?',
              'Рация будет обновлять позицию как раньше и меньше тратить батарею. Она перезагрузится (около 10 секунд).',
              'Вернуть',
              () =>
                radio.restoreGps().catch((e: Error) => Alert.alert('Не получилось', e.message))
            )
          }
        />
      )}
    </View>
  );
}

function askSpeedUp(radio: Radio) {
  const was = radio.gps.config?.updateInterval || 120;
  confirmAction(
    'Ускорить GPS рации?',
    `Сейчас GPS рации обновляет позицию раз в ${was} с. GrimMap поставит раз в 5 с и попросит рацию сообщать точность и число спутников. ` +
      'В эфир чаще ничего не уходит, но батарея рации будет садиться быстрее. Рация перезагрузится (около 10 секунд). ' +
      'Вернуть как было можно здесь же.',
    'Ускорить',
    () => radio.speedUpGps().catch((e: Error) => Alert.alert('Не получилось', e.message))
  );
}

/** Browser: the radio comes from the browser's own chooser, opened by a click. */
function WebPick({ radio }: { radio: Radio }) {
  const pick = (kind: 'ble' | 'usb') => {
    tap();
    pickRadio(kind)
      .then((d) => d && radio.choose(d))
      .catch((e: Error) => Alert.alert('Рация не подключилась', e.message));
  };
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.row}>
        <Button title="Bluetooth" icon="bluetooth-connect" kind="secondary" style={{ flex: 1 }} onPress={() => pick('ble')} />
        <Button title="USB-кабель" icon="usb" kind="secondary" style={{ flex: 1 }} onPress={() => pick('usb')} />
      </View>
      <Text style={styles.sub}>
        USB-кабель надёжнее Bluetooth на ноутбуке. Если рации нет в списке USB, поставьте драйвер CP210x или CH340
        (зависит от платы); у T114 и RAK драйвер не нужен.
      </Text>
    </View>
  );
}

function Header() {
  return (
    <View style={styles.head}>
      <Icon name="radio-tower" size={20} color={C.accent} />
      <Text style={styles.title}>Рация Meshtastic</Text>
    </View>
  );
}

export function RadioPicker({
  visible,
  radio,
  onClose,
  onPick,
}: {
  visible: boolean;
  radio: Radio;
  onClose: () => void;
  onPick: (d: RadioDevice) => void;
}) {
  const [found, setFound] = useState<RadioDevice[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [slow, setSlow] = useState(false);
  const [round, setRound] = useState(0);
  const { scan } = radio;
  useEffect(() => {
    if (!visible) return;
    setFound([]);
    setSlow(false);
    const hint = setTimeout(() => setSlow(true), 8000);
    let stop: (() => void) | null = null;
    let cancelled = false;
    scan((d) => setFound((cur) => (cur.some((x) => x.id === d.id) ? cur : [...cur, d]))).then((s) => {
      if (cancelled) s();
      else stop = s;
    });
    // Scanning drains the battery; a short window is enough.
    const t = setTimeout(() => stop?.(), 20_000);
    return () => {
      cancelled = true;
      clearTimeout(t);
      clearTimeout(hint);
      stop?.();
    };
  }, [visible, scan, round]);

  const radios = found.filter((d) => !d.other);
  const others = found.filter((d) => d.other).sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));
  const shown = showAll ? [...radios, ...others] : radios;

  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={styles.sheetTitle}>Найти рацию</Text>
      <Text style={styles.sub}>
        Включите рацию рядом с телефоном (Heltec V3, T114 и другие с прошивкой Meshtastic). При первом подключении
        телефон спросит PIN-код: он появится на экране рации, а если экрана нет или PIN фиксированный — 123456.
      </Text>
      {radio.error && <Text style={[styles.sub, { color: C.danger }]}>{radio.error}</Text>}
      {shown.length === 0 && (
        <View style={styles.searching}>
          <Icon name="bluetooth-audio" size={20} color={C.dim} />
          <Text style={styles.sub}>Ищу рации поблизости…</Text>
        </View>
      )}
      {shown.length > 0 &&
        shown.map((d) => (
          <Pressable
            key={d.id}
            onPress={() => {
              tap();
              onPick(d);
            }}
            style={({ pressed }) => [styles.found, pressed && { opacity: 0.7 }]}
          >
            <Icon name={d.other ? 'bluetooth' : 'radio-handheld'} size={22} color={d.other ? C.dim : C.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.device} numberOfLines={1}>
                {d.name}
              </Text>
              {d.connected && <Text style={styles.nodeSub}>уже подключена к телефону</Text>}
            </View>
            {d.rssi != null && <Text style={styles.nodeSub}>{d.rssi} dBm</Text>}
          </Pressable>
        ))}
      {slow && radios.length === 0 && (
        <View style={styles.tips}>
          <Text style={styles.tipsTitle}>Не находится? Проверьте:</Text>
          <Text style={styles.sub}>• Рацию не держит приложение Meshtastic или другой телефон: подключённая рация не видна. Отключитесь там (или закройте приложение) и нажмите «Искать снова».</Text>
          <Text style={styles.sub}>• Включена геолокация (GPS) телефона и разрешён доступ к местоположению: без этого Android не показывает Bluetooth-устройства.</Text>
          <Text style={styles.sub}>• В рации включён Bluetooth (Meshtastic: Config → Bluetooth → Enabled) и она рядом, не дальше пары метров.</Text>
          <Text style={styles.sub}>• Рация видна в списке ниже под другим именем — откройте «Все устройства».</Text>
        </View>
      )}
      <View style={styles.row}>
        <Button
          title="Искать снова"
          icon="refresh"
          kind="secondary"
          style={{ flex: 1 }}
          onPress={() => setRound((r) => r + 1)}
        />
        <Button
          title={showAll ? 'Только рации' : `Все устройства${others.length ? ` · ${others.length}` : ''}`}
          kind="ghost"
          style={{ flex: 1 }}
          onPress={() => setShowAll((v) => !v)}
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { color: C.text, fontSize: 16, fontFamily: F.semibold, flex: 1 },
  sub: { color: C.dim, fontSize: 13, fontFamily: F.regular, lineHeight: 18 },
  deviceRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  device: { color: C.text, fontSize: 15, fontFamily: F.semibold },
  row: { flexDirection: 'row', gap: 10 },
  chip: {
    flex: 1,
    height: 36,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: C.accent, borderColor: C.accent },
  chipText: { color: C.text, fontSize: 14, fontFamily: F.semibold },
  node: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  nodeName: { color: C.text, fontSize: 14, fontFamily: F.regular, flex: 1 },
  nodeSub: { color: C.faint, fontSize: 12, fontFamily: F.mono },
  sheetTitle: { color: C.text, fontSize: 22, fontFamily: F.bold },
  tips: { gap: 6, padding: 12, borderRadius: R.md, backgroundColor: C.elevated, borderWidth: 1, borderColor: C.line },
  tipsTitle: { color: C.text, fontSize: 14, fontFamily: F.semibold },
  searching: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  found: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: R.md,
    backgroundColor: C.elevated,
    borderWidth: 1,
    borderColor: C.line,
  },
});
