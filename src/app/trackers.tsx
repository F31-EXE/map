import { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { timeAgo } from '../lib/geo';
import { nodeIdText, squadPsk } from '../lib/meshtastic';
import { DEFAULT_TEAM_COLOR, TEAM_COLORS } from '../lib/roles';
import { clipName, parseNodeId, shortFrom, TRACKER_VIS, type TrackerVis } from '../lib/trackers';
import { pickRadio, type RadioDevice } from '../services/meshRadio';
import { setupTracker } from '../services/trackerSetup';
import { removeTracker, saveTracker } from '../services/trackers';
import { useSession } from '../state/session';
import { useTrackers, type TrackerView } from '../state/trackers';
import { Button, Card, Eyebrow, Icon, KeyboardScroll, Sheet, tap } from '../ui/components';
import { confirmDestructive } from '../ui/confirm';
import { RadioPicker } from '../ui/RadioCard';
import { C, F, R } from '../ui/theme';

const STALE_MS = 5 * 60_000;
const WEB = Platform.OS === 'web';

type Source = 'setup' | 'heard' | 'id';

type Draft = {
  isNew: boolean;
  source: Source;
  device: RadioDevice | null;
  num: number | null;
  idText: string;
  name: string;
  color: string;
  vis: TrackerVis;
  viewers: string[];
};

/**
 * «Трекеры отряда»: radios with GPS and no phone (a fighter without one, a radio
 * handed to an allied unit). Commanders add them — setting up a radio over Bluetooth
 * once, or picking one already on the squad channel — and choose who sees them.
 */
export default function TrackersScreen() {
  const s = useSession();
  const { trackers, visible } = useTrackers();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 10_000);
    return () => clearInterval(t);
  }, []);
  const now = Date.now();
  const list = s.canCommand ? trackers : visible;

  const open = (t?: TrackerView) =>
    setDraft(
      t
        ? { isNew: false, source: 'id', device: null, num: t.num, idText: nodeIdText(t.num), name: t.name, color: t.color, vis: t.vis, viewers: t.viewers }
        : { isNew: true, source: 'setup', device: null, num: null, idText: '', name: '', color: TEAM_COLORS[3], vis: 'all', viewers: [] }
    );

  return (
    <KeyboardScroll contentContainerStyle={styles.content}>
      <Card style={{ gap: 8 }}>
        <View style={styles.inline}>
          <Icon name="radio-handheld" size={22} color={C.accent} />
          <Text style={styles.title}>Трекеры отряда</Text>
        </View>
        <Text style={styles.text}>
          Рация Meshtastic с GPS без телефона: для бойца без смартфона или для союзного подразделения рядом. Трекер шлёт
          позицию в закрытом канале отряда. Его видит на карте любой телефон отряда с рацией, а через интернет — весь
          отряд.
        </Text>
      </Card>

      {list.length === 0 ? (
        <Card>
          <Text style={styles.text}>Трекеров пока нет.</Text>
        </Card>
      ) : (
        <Card style={{ gap: 0, paddingVertical: 6 }}>
          {list.map((t, i) => {
            const fresh = t.fix && now - t.fix.at < STALE_MS;
            return (
              <Pressable
                key={t.num}
                disabled={!s.canCommand}
                onPress={() => open(t)}
                style={[styles.row, i > 0 && styles.rowLine]}
              >
                <View style={[styles.dot, { backgroundColor: t.color, opacity: fresh ? 1 : 0.4 }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>
                    {t.name} <Text style={styles.sub}>{t.short ? `· ${t.short}` : ''}</Text>
                  </Text>
                  <Text style={styles.sub} numberOfLines={1}>
                    {nodeIdText(t.num)} · {t.fix ? `сигнал ${timeAgo(t.fix.at)}${t.heardHere ? ' (моя рация)' : ''}` : 'ещё не слышно'}
                    {s.canCommand ? ` · видят: ${TRACKER_VIS.find((v) => v.id === t.vis)?.title.toLowerCase()}` : ''}
                  </Text>
                </View>
                {s.canCommand && <Icon name="chevron-right" size={20} color={C.faint} />}
              </Pressable>
            );
          })}
        </Card>
      )}

      {s.canCommand && <Button title="Добавить трекер" icon="plus" onPress={() => open()} />}

      {draft && <Editor draft={draft} setDraft={setDraft} onClose={() => setDraft(null)} />}
    </KeyboardScroll>
  );
}

function Editor({ draft, setDraft, onClose }: { draft: Draft; setDraft: (d: Draft) => void; onClose: () => void }) {
  const s = useSession();
  const radio = s.mesh.radio;
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const set = (p: Partial<Draft>) => setDraft({ ...draft, ...p });
  const name = clipName(draft.name);
  const short = shortFrom(name);
  const heard = radio.nodes.filter((n) => n.num !== radio.myNode);

  const save = async () => {
    if (!s.teamId || !s.uid) return;
    if (!name) throw new Error('Введите позывной трекера');
    let num = draft.num;
    if (draft.isNew && draft.source === 'id') num = parseNodeId(draft.idText);
    if (draft.isNew && draft.source === 'setup') {
      if (!draft.device) throw new Error('Выберите ноду для настройки');
      if (draft.device.id === radio.device?.id) throw new Error('Это ваша рация. Трекером делают другую ноду');
      const r = await setupTracker(draft.device, { name, short, psk: squadPsk(s.teamId) }, setBusy);
      num = r.num;
    }
    if (num == null) throw new Error('Не указана нода');
    setBusy('Сохраняю…');
    await saveTracker(
      s.teamId,
      s.uid,
      { num, name, short, role: 'rifleman', color: draft.color, vis: draft.vis, viewers: draft.vis === 'chosen' ? draft.viewers : [] },
      draft.isNew
    );
  };

  const run = () => {
    tap();
    setBusy('…');
    save()
      .then(() => {
        onClose();
        if (draft.isNew && draft.source === 'setup') {
          Alert.alert('Трекер готов', 'Нода перезагрузится и через минуту начнёт слать позицию в канале отряда.');
        }
      })
      .catch((e: Error) => Alert.alert('Не получилось', e.message))
      .finally(() => setBusy(null));
  };

  return (
    <Sheet visible onClose={onClose}>
      <Text style={styles.sheetTitle}>{draft.isNew ? 'Новый трекер' : draft.name}</Text>

      {draft.isNew && (
        <>
          <Eyebrow>Нода</Eyebrow>
          <View style={styles.chips}>
            <Chip on={draft.source === 'setup'} text="Настроить по Bluetooth" onPress={() => set({ source: 'setup' })} />
            <Chip on={draft.source === 'heard'} text="Из эфира" onPress={() => set({ source: 'heard' })} />
            <Chip on={draft.source === 'id'} text="По номеру" onPress={() => set({ source: 'id' })} />
          </View>
          {draft.source === 'setup' && (
            <>
              <Text style={styles.sub}>
                Включите ноду рядом с телефоном. GrimMap запишет в неё позывной, закрытый канал отряда и частую передачу
                позиции; в общем канале позиции не будет. Ваша рация останется на связи.
              </Text>
              <Button
                title={draft.device ? `Нода: ${draft.device.name}` : 'Выбрать ноду'}
                icon="bluetooth-connect"
                kind="secondary"
                onPress={() => {
                  if (!WEB) {
                    setPicking(true);
                    return;
                  }
                  pickRadio('ble')
                    .then((d) => d && set({ device: d }))
                    .catch((e: Error) => Alert.alert('Нода не подключилась', e.message));
                }}
              />
            </>
          )}
          {draft.source === 'heard' && (
            <View style={{ gap: 6 }}>
              <Text style={styles.sub}>
                Нода, которую уже слышит ваша рация. Чтобы её позицию не видели посторонние, настройте её по Bluetooth.
              </Text>
              {heard.length === 0 && <Text style={styles.sub}>Ваша рация пока никого не слышит.</Text>}
              {heard.slice(0, 20).map((n) => (
                <Pressable
                  key={n.num}
                  onPress={() => set({ num: n.num, name: draft.name || n.longName })}
                  style={[styles.pick, draft.num === n.num && styles.pickOn]}
                >
                  <Text style={styles.name} numberOfLines={1}>
                    {n.longName || n.shortName || nodeIdText(n.num)}
                  </Text>
                  <Text style={styles.sub}>
                    {nodeIdText(n.num)} · {n.lat != null ? 'с GPS' : 'без позиции'}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          {draft.source === 'id' && (
            <TextInput
              value={draft.idText}
              onChangeText={(t) => set({ idText: t })}
              placeholder="Номер ноды, например !a1b2c3d4"
              placeholderTextColor={C.faint}
              autoCapitalize="none"
              style={styles.input}
              selectionColor={C.accent}
            />
          )}
        </>
      )}

      <Eyebrow>Позывной</Eyebrow>
      <TextInput
        value={draft.name}
        onChangeText={(t) => set({ name: t })}
        placeholder="Например «Союзники-1»"
        placeholderTextColor={C.faint}
        maxLength={30}
        style={styles.input}
        selectionColor={C.accent}
      />
      <Text style={styles.sub}>
        На рации: «{name || '…'}», коротко «{short}».{' '}
        {!draft.isNew ? 'Имя на самой ноде меняется только при настройке по Bluetooth.' : ''}
      </Text>

      <Eyebrow>Цвет</Eyebrow>
      <View style={styles.chips}>
        {TEAM_COLORS.map((c) => (
          <Pressable
            key={c}
            onPress={() => set({ color: c })}
            style={[styles.color, { backgroundColor: c }, draft.color === c && styles.colorOn]}
          />
        ))}
      </View>

      <Eyebrow>Кто видит на карте</Eyebrow>
      <View style={styles.chips}>
        {TRACKER_VIS.map((v) => (
          <Chip key={v.id} on={draft.vis === v.id} text={v.title} onPress={() => set({ vis: v.id })} />
        ))}
      </View>
      {draft.vis === 'chosen' && (
        <View style={styles.chips}>
          {s.members
            .filter((m) => !m.canCommand && m.id !== s.team?.ownerId)
            .map((m) => {
              const on = draft.viewers.includes(m.id);
              return (
                <Chip
                  key={m.id}
                  on={on}
                  text={m.callsign}
                  onPress={() => set({ viewers: on ? draft.viewers.filter((x) => x !== m.id) : [...draft.viewers, m.id] })}
                />
              );
            })}
        </View>
      )}
      <Text style={styles.sub}>Командиры видят все трекеры.</Text>

      <Button
        title={draft.isNew ? (draft.source === 'setup' ? 'Настроить и добавить' : 'Добавить') : 'Сохранить'}
        icon="check"
        busy={busy != null}
        onPress={run}
      />
      {busy && busy !== '…' && <Text style={styles.sub}>{busy}</Text>}
      {!draft.isNew && draft.num != null && (
        <Button
          title="Убрать трекер"
          kind="danger"
          icon="delete-outline"
          onPress={() =>
            confirmDestructive('Убрать трекер?', `${draft.name} пропадёт с карты отряда. Саму ноду это не меняет.`, 'Убрать', () =>
              removeTracker(s.teamId!, draft.num!)
                .then(onClose)
                .catch((e: Error) => Alert.alert('Не получилось', e.message))
            )
          }
        />
      )}

      {!WEB && (
        <RadioPicker
          visible={picking}
          radio={radio}
          onClose={() => setPicking(false)}
          onPick={(d) => {
            setPicking(false);
            set({ device: d, name: draft.name || (d.name.startsWith('Meshtastic') ? '' : d.name) });
          }}
        />
      )}
    </Sheet>
  );
}

function Chip({ on, text, onPress }: { on: boolean; text: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
      style={[styles.chip, on && styles.chipOn]}
    >
      <Text style={[styles.chipText, on && { color: C.accentInk }]}>{text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, width: '100%', maxWidth: 640, alignSelf: 'center' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { color: C.text, fontSize: 18, fontFamily: F.bold },
  text: { color: C.text, fontSize: 14, fontFamily: F.regular, lineHeight: 20 },
  sub: { color: C.dim, fontSize: 12, fontFamily: F.regular, lineHeight: 17 },
  name: { color: C.text, fontSize: 15, fontFamily: F.semibold },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 4 },
  rowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  dot: { width: 14, height: 14, borderRadius: 7 },
  sheetTitle: { color: C.text, fontSize: 22, fontFamily: F.bold },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    height: 34,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.elevated,
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: C.accent, borderColor: C.accent },
  chipText: { color: C.text, fontSize: 13, fontFamily: F.semibold },
  color: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: 'transparent' },
  colorOn: { borderColor: C.text },
  input: {
    height: 46,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.elevated,
    color: C.text,
    paddingHorizontal: 12,
    fontSize: 15,
    fontFamily: F.regular,
  },
  pick: { padding: 10, borderRadius: R.md, borderWidth: 1, borderColor: C.line, backgroundColor: C.elevated, gap: 2 },
  pickOn: { borderColor: C.accent },
});
