import { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { timeAgo } from '../lib/geo';
import { nodeIdText } from '../lib/meshtastic';
import { pickRadio, type RadioDevice } from '../services/meshRadio';
import type { Radio } from '../state/useRadio';

import { Button, Card, Eyebrow, Icon, Sheet, tap } from './components';
import { confirmDestructive } from './confirm';
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

function RadioPicker({
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
  const { scan } = radio;
  useEffect(() => {
    if (!visible) return;
    setFound([]);
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
      stop?.();
    };
  }, [visible, scan]);

  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={styles.sheetTitle}>Найти рацию</Text>
      <Text style={styles.sub}>
        Включите рацию рядом с телефоном (Heltec V3, T114 и другие с прошивкой Meshtastic). При первом подключении
        телефон спросит PIN-код: он появится на экране рации, а если экрана нет или PIN фиксированный — 123456.
      </Text>
      {radio.error && <Text style={[styles.sub, { color: C.danger }]}>{radio.error}</Text>}
      {found.length === 0 ? (
        <View style={styles.searching}>
          <Icon name="bluetooth-audio" size={20} color={C.dim} />
          <Text style={styles.sub}>Ищу рации поблизости…</Text>
        </View>
      ) : (
        found.map((d) => (
          <Pressable
            key={d.id}
            onPress={() => {
              tap();
              onPick(d);
            }}
            style={({ pressed }) => [styles.found, pressed && { opacity: 0.7 }]}
          >
            <Icon name="radio-handheld" size={22} color={C.accent} />
            <Text style={[styles.device, { flex: 1 }]} numberOfLines={1}>
              {d.name}
            </Text>
            {d.rssi != null && <Text style={styles.nodeSub}>{d.rssi} dBm</Text>}
          </Pressable>
        ))
      )}
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
  node: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  nodeName: { color: C.text, fontSize: 14, fontFamily: F.regular, flex: 1 },
  nodeSub: { color: C.faint, fontSize: 12, fontFamily: F.mono },
  sheetTitle: { color: C.text, fontSize: 22, fontFamily: F.bold },
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
