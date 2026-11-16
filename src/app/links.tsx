import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { distanceMeters, formatDistance, timeAgo } from '../lib/geo';
import { nodeIdText } from '../lib/meshtastic';
import { powerText } from '../lib/power';
import { ROLES } from '../lib/roles';
import { useSession } from '../state/session';
import { Card, Eyebrow, Icon, RoleIcon, type IconName } from '../ui/components';
import { C, F } from '../ui/theme';

/** Older than this, a link counts as lost. */
const FRESH_MS = 3 * 60_000;

/**
 * «Связь отряда» for signallers: who is on air by which path (server, Bluetooth/Wi-Fi
 * between phones, LoRa radio), when each was last heard, batteries, and the radios this
 * phone's radio hears with their distance.
 */
export default function LinksScreen() {
  const s = useSession();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 5000);
    return () => clearInterval(t);
  }, []);
  const now = Date.now();
  const radio = s.mesh.radio;
  // The last fix the session has: no second GPS watcher just for this screen.
  const position = s.getLastFix();

  if (!s.teamId) {
    return (
      <View style={styles.empty}>
        <Text style={styles.dim}>Сводка связи — для отряда.</Text>
      </View>
    );
  }

  const members = [...s.members].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  const lost = members.filter((m) => m.id !== s.uid && (!m.updatedAt || now - m.updatedAt > FRESH_MS));

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Card style={{ gap: 8 }}>
        <Eyebrow>Мой телефон</Eyebrow>
        <Line
          icon="bluetooth"
          label="Телефоны рядом"
          value={s.mesh.enabled ? `${s.mesh.peers} на связи` : 'выключено'}
          ok={s.mesh.peers > 0}
        />
        <Line
          icon="radio-handheld"
          label="Рация"
          value={
            radio.state === 'ready'
              ? `${radio.device?.name ?? 'подключена'}${radio.myBattery != null ? ` · ${radio.myBattery > 100 ? 'от сети' : `${radio.myBattery}%`}` : ''}`
              : radio.device
                ? 'не на связи'
                : 'не выбрана'
          }
          ok={radio.state === 'ready'}
        />
        {lost.length > 0 && (
          <Text style={[styles.dim, { color: C.warn }]}>
            Пропали со связи больше 3 мин: {lost.map((m) => m.callsign).join(', ')}
          </Text>
        )}
      </Card>

      <Eyebrow style={{ paddingHorizontal: 4 }}>Бойцы · {members.length}</Eyebrow>
      {members.map((m) => {
        const via = s.mesh.heardAt(m.id);
        const fresh = m.updatedAt != null && now - m.updatedAt < FRESH_MS;
        const where = position && m.lat != null && m.lng != null ? formatDistance(distanceMeters(position, { lat: m.lat, lng: m.lng })) : null;
        return (
          <Card key={m.id} style={{ gap: 6 }}>
            <View style={styles.row}>
              <RoleIcon role={m.role} size={22} color={fresh ? C.accent : C.faint} />
              <Text style={[styles.name, { flex: 1 }]} numberOfLines={1}>
                {m.callsign}
                {m.id === s.uid ? ' · вы' : ''}
              </Text>
              <Text style={[styles.mono, { color: fresh ? C.accent : C.warn }]}>
                {m.updatedAt ? timeAgo(m.updatedAt, now) : 'нет данных'}
              </Text>
            </View>
            <Text style={styles.dim}>
              {ROLES[m.role].title}
              {where ? ` · ${where} от вас` : ''}
              {powerText(m) ? ` · ${powerText(m)}` : ''}
            </Text>
            {m.id !== s.uid && (
              <View style={styles.row}>
                <Chip icon="bluetooth" text={via.nearby ? timeAgo(via.nearby, now) : '—'} on={via.nearby != null && now - via.nearby < FRESH_MS} />
                <Chip icon="radio-handheld" text={via.radio ? timeAgo(via.radio, now) : '—'} on={via.radio != null && now - via.radio < FRESH_MS} />
              </View>
            )}
          </Card>
        );
      })}

      {radio.nodes.length > 0 && (
        <>
          <Eyebrow style={{ paddingHorizontal: 4 }}>Рации в эфире · {radio.nodes.length}</Eyebrow>
          <Card style={{ gap: 8 }}>
            {radio.nodes.slice(0, 30).map((n) => (
              <View key={n.num} style={styles.row}>
                <Icon name="radio-handheld" size={18} color={now - n.lastHeard < FRESH_MS ? C.accent : C.faint} />
                <Text style={[styles.name, { flex: 1 }]} numberOfLines={1}>
                  {n.longName || nodeIdText(n.num)}
                </Text>
                <Text style={styles.mono}>
                  {position && n.lat != null && n.lng != null ? `${formatDistance(distanceMeters(position, { lat: n.lat, lng: n.lng }))} · ` : ''}
                  {timeAgo(n.lastHeard, now)}
                </Text>
              </View>
            ))}
            <Text style={styles.dim}>
              Дальность связи — до самой дальней рации, которую слышно: по ней видно, докуда достаёт эфир.
            </Text>
          </Card>
        </>
      )}
    </ScrollView>
  );
}

function Line({ icon, label, value, ok }: { icon: IconName; label: string; value: string; ok: boolean }) {
  return (
    <View style={styles.row}>
      <Icon name={icon} size={18} color={ok ? C.accent : C.faint} />
      <Text style={[styles.dim, { flex: 1 }]}>{label}</Text>
      <Text style={[styles.mono, { color: ok ? C.text : C.faint }]}>{value}</Text>
    </View>
  );
}

function Chip({ icon, text, on }: { icon: IconName; text: string; on: boolean }) {
  return (
    <View style={[styles.chip, on && { borderColor: C.accent }]}>
      <Icon name={icon} size={14} color={on ? C.accent : C.faint} />
      <Text style={[styles.mono, { color: on ? C.text : C.faint }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10, paddingBottom: 48, width: '100%', maxWidth: 640, alignSelf: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { color: C.text, fontSize: 15, fontFamily: F.semibold },
  dim: { color: C.dim, fontSize: 13, fontFamily: F.regular },
  mono: { color: C.dim, fontSize: 12, fontFamily: F.mono },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.line,
  },
});
