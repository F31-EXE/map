import * as Clipboard from 'expo-clipboard';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { timeAgo } from '../lib/geo';
import { inviteUrl } from '../lib/invite';
import { TEAM_COLORS } from '../lib/roles';
import { STALE_MS } from '../map/TacticalMap';
import { useSession } from '../state/session';
import { useSide, type Squad } from '../state/side';
import { Button, Card, Eyebrow, Icon, KeyboardScroll, tap } from '../ui/components';
import { QrCode } from '../ui/QrCode';
import { C, F, R } from '../ui/theme';

export default function SideScreen() {
  const session = useSession();
  const headerHeight = useHeaderHeight();
  const side = useSide();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      Alert.alert('Ошибка', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!session.firebaseEnabled || !session.uid) {
    return (
      <View style={styles.content}>
        <Card>
          <Text style={styles.text}>Командование стороной работает только с подключением к серверу.</Text>
        </Card>
      </View>
    );
  }

  if (!side.isSideCommander) {
    return (
      <KeyboardScroll contentContainerStyle={styles.content} headerOffset={headerHeight}>
        <Card style={{ gap: 14 }}>
          <View style={styles.inline}>
            <Icon name="flag-variant" size={26} color={C.accent} />
            <Text style={styles.title}>Командир стороны</Text>
          </View>
          <Text style={styles.text}>
            Объединяет несколько отрядов. Видит все отряды на карте, раскрашивает их для себя, отдаёт приказы
            командирам отрядов — одному отряду или всем сразу.
          </Text>
          <Text style={styles.text}>
            Создайте сторону и покажите её QR-код командирам отрядов: они отсканируют его в своём приложении.
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Название, например «Синие»"
            placeholderTextColor={C.faint}
            maxLength={40}
            style={styles.input}
            selectionColor={C.accent}
          />
          <Button title="Создать сторону" icon="flag-plus" busy={busy} onPress={() => run(() => side.createSide(name))} />
        </Card>
      </KeyboardScroll>
    );
  }

  const s = side.side!;
  const link = inviteUrl({ kind: 'side', code: s.code });
  const now = Date.now();
  const totalFighters = side.squads.reduce((n, sq) => n + sq.members.length, 0);

  return (
    <KeyboardScroll contentContainerStyle={styles.content} headerOffset={headerHeight}>
      <Card style={{ gap: 14, alignItems: 'center' }}>
        <View style={{ alignSelf: 'stretch' }}>
          <Eyebrow>Сторона</Eyebrow>
          <Text style={styles.title}>{s.name}</Text>
          <Text style={styles.sub}>
            {side.squads.length} отр. · {totalFighters} бойцов
          </Text>
        </View>
        <QrCode value={link} size={200} />
        <Text style={styles.text}>Командир отряда сканирует этот код: Команда → «Присоединить к стороне».</Text>
        <Text style={styles.code} selectable>
          {s.code}
        </Text>
        <View style={styles.row}>
          <Button
            title={copied ? 'Скопировано' : 'Копировать'}
            icon={copied ? 'check' : 'content-copy'}
            kind="secondary"
            style={{ flex: 1 }}
            onPress={() => {
              Clipboard.setStringAsync(s.code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          />
          <Button
            title="Отправить"
            icon="share-variant"
            style={{ flex: 1 }}
            onPress={() =>
              Share.share({ message: `Присоедини отряд к стороне «${s.name}» в GrimMap: код ${s.code}\n${link}` })
            }
          />
        </View>
      </Card>

      <Card style={styles.switchRow}>
        <View style={[styles.switchIcon, side.showAll && { backgroundColor: C.accentSoft }]}>
          <Icon name={side.showAll ? 'account-multiple' : 'star'} size={22} color={side.showAll ? C.accent : C.warn} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{side.showAll ? 'Все бойцы' : 'Только командиры'}</Text>
          <Text style={styles.sub}>Кого из отрядов показывать на вашей карте</Text>
        </View>
        <Switch
          value={side.showAll}
          onValueChange={(v) => side.setShowAll(v)}
          trackColor={{ true: C.accent, false: C.warn }}
          thumbColor="#fff"
        />
      </Card>

      <View style={{ gap: 10 }}>
        <Eyebrow style={{ paddingHorizontal: 4 }}>Отряды · цвета видите только вы</Eyebrow>
        {side.squads.length === 0 ? (
          <Card>
            <Text style={styles.text}>Пока ни один отряд не присоединился.</Text>
          </Card>
        ) : (
          side.squads.map((sq) => (
            <SquadCard
              key={sq.id}
              sq={sq}
              now={now}
              editing={editing === sq.id}
              onEdit={() => setEditing(editing === sq.id ? null : sq.id)}
              onColor={(c) => {
                tap();
                side.setSquadColor(sq.id, c);
                setEditing(null);
              }}
              onDrop={() =>
                Alert.alert('Отключить отряд от стороны?', sq.name, [
                  { text: 'Отмена', style: 'cancel' },
                  { text: 'Отключить', style: 'destructive', onPress: () => run(() => side.dropSquad(sq.id)) },
                ])
              }
            />
          ))
        )}
      </View>

      <Button
        title="Сложить полномочия"
        kind="danger"
        icon="flag-off-outline"
        onPress={() =>
          Alert.alert(
            'Сложить полномочия?',
            'Сторона перестанет отображаться у вас. Отряды останутся привязанными к ней.',
            [
              { text: 'Отмена', style: 'cancel' },
              { text: 'Сложить', style: 'destructive', onPress: () => run(side.resign) },
            ]
          )
        }
      />
    </KeyboardScroll>
  );
}

function SquadCard({
  sq,
  now,
  editing,
  onEdit,
  onColor,
  onDrop,
}: {
  sq: Squad;
  now: number;
  editing: boolean;
  onEdit: () => void;
  onColor: (c: string | null) => void;
  onDrop: () => void;
}) {
  const online = sq.members.filter((m) => m.updatedAt && now - m.updatedAt < STALE_MS).length;
  const lastSeen = Math.max(0, ...sq.members.map((m) => m.updatedAt ?? 0));
  return (
    <Card style={{ gap: 12 }}>
      <View style={styles.squadRow}>
        <Pressable onPress={onEdit} accessibilityLabel={`Цвет отряда ${sq.name}`}>
          <View style={[styles.swatch, { backgroundColor: sq.displayColor }]}>
            <Icon name="palette" size={16} color={C.accentInk} />
          </View>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {sq.name}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {sq.leaderName ? `★ ${sq.leaderName} · ` : ''}
            {online}/{sq.members.length} в сети
            {lastSeen ? ` · ${timeAgo(lastSeen)}` : ''}
          </Text>
        </View>
        <Pressable hitSlop={6} style={styles.iconButton} onPress={onDrop} accessibilityLabel="Отключить отряд">
          <Icon name="link-variant-off" size={18} color={C.dim} />
        </Pressable>
      </View>
      {editing && (
        <View style={styles.palette}>
          {TEAM_COLORS.map((c) => (
            <Pressable
              key={c}
              onPress={() => onColor(c)}
              style={[styles.colorDot, { backgroundColor: c }, c === sq.displayColor && styles.colorDotActive]}
            >
              {c === sq.displayColor && <Icon name="check" size={16} color={C.accentInk} />}
            </Pressable>
          ))}
          <Pressable onPress={() => onColor(null)} style={[styles.colorDot, styles.resetDot]}>
            <Icon name="restore" size={16} color={C.dim} />
          </Pressable>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14, paddingBottom: 48, width: '100%', maxWidth: 640, alignSelf: 'center' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { color: C.text, fontSize: 24, fontFamily: F.bold },
  cardTitle: { color: C.text, fontSize: 16, fontFamily: F.semibold },
  text: { color: C.dim, fontSize: 15, lineHeight: 21, fontFamily: F.regular },
  sub: { color: C.dim, fontSize: 13, fontFamily: F.regular, marginTop: 1 },
  code: { color: C.accent, fontSize: 30, fontFamily: F.mono, letterSpacing: 6 },
  row: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
  input: {
    backgroundColor: C.elevated,
    color: C.text,
    borderRadius: R.md,
    paddingHorizontal: 14,
    height: 52,
    borderWidth: 1,
    borderColor: C.line,
    fontSize: 16,
    fontFamily: F.regular,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  switchIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(255,200,61,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  squadRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  swatch: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: C.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  palette: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  colorDot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorDotActive: { borderColor: C.text },
  resetDot: { backgroundColor: C.elevated, borderColor: C.line },
});
