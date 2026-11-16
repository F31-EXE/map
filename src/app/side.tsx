import { router } from 'expo-router';
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
import { confirmDestructive } from '../ui/confirm';
import { GameLinkCard } from '../ui/GameLinkCard';
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

      {side.isDeputy && (
        <Card style={{ gap: 6 }}>
          <View style={styles.inline}>
            <Icon name="radio-tower" size={22} color={C.accent} />
            <Text style={styles.cardTitle}>Вы связист штаба</Text>
          </View>
          <Text style={styles.text}>
            Командир стороны дал вам свои права: вся карта стороны, приказы отрядам, брифинги, в большой игре — постройки
            и удары. Снять с должности может только командир стороны.
          </Text>
        </Card>
      )}

      <Button title="Чат стороны" icon="forum-outline" kind="secondary" onPress={() => router.push('/side-chat')} />

      {!side.isDeputy && <DeputiesCard run={run} />}

      <GameLinkCard />

      <Card style={styles.switchRow}>
        <View style={[styles.switchIcon, side.showAll && { backgroundColor: C.accentSoft }]}>
          <Icon name={side.showAll ? 'account-multiple' : 'star'} size={22} color={side.showAll ? C.accent : C.warn} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{side.showAll ? 'Все бойцы' : 'Командиры отрядов'}</Text>
          <Text style={styles.sub}>
            {side.showAll
              ? 'На карте все бойцы всех отрядов'
              : 'Одна метка на отряд: командир с названием отряда'}
          </Text>
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
              canDrop={!side.isDeputy}
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
                confirmDestructive('Отключить отряд от стороны?', sq.name, 'Отключить', () =>
                  run(() => side.dropSquad(sq.id))
                )
              }
            />
          ))
        )}
      </View>

      {!side.isDeputy && (
        <Button
          title="Сложить полномочия"
          kind="danger"
          icon="flag-off-outline"
          onPress={() =>
            confirmDestructive(
              'Сложить полномочия?',
              'Сторона перестанет отображаться у вас. Отряды останутся привязанными к ней.',
              'Сложить',
              () => run(side.resign)
            )
          }
        />
      )}
    </KeyboardScroll>
  );
}

/**
 * HQ signallers: the commander names fighters of the side's squads (signallers first);
 * they get the commander's rights and keep the side running while the commander is busy.
 */
function DeputiesCard({ run }: { run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const side = useSide();
  const [picking, setPicking] = useState(false);
  const deputies = Object.entries(side.side?.deputies ?? {});
  const candidates = side.squads
    .flatMap((sq) => sq.members.map((m) => ({ m, sq })))
    .filter(({ m }) => !side.side?.deputies?.[m.id] && m.id !== side.side?.ownerId)
    .sort((a, b) => Number(b.m.role === 'radio') - Number(a.m.role === 'radio') || a.m.callsign.localeCompare(b.m.callsign));
  return (
    <Card style={{ gap: 10 }}>
      <Eyebrow>Связисты штаба · {deputies.length}</Eyebrow>
      <Text style={styles.sub}>
        Получают ваши права: ведут сторону, пока вы на связи с оргами или отошли. Видят всю карту, отдают приказы.
      </Text>
      {deputies.map(([id, name]) => (
        <View key={id} style={styles.squadRow}>
          <Icon name="radio-tower" size={20} color={C.accent} />
          <Text style={[styles.cardTitle, { flex: 1 }]} numberOfLines={1}>
            {name}
          </Text>
          <Pressable
            hitSlop={8}
            onPress={() =>
              confirmDestructive(`Снять ${name} со связи штаба?`, 'Права командира стороны у него пропадут.', 'Снять', () =>
                run(() => side.setDeputy(id, null))
              )
            }
            accessibilityLabel={`Снять ${name}`}
          >
            <Icon name="account-remove-outline" size={20} color={C.dim} />
          </Pressable>
        </View>
      ))}
      {picking ? (
        candidates.length === 0 ? (
          <Text style={styles.sub}>В отрядах стороны пока некого назначить.</Text>
        ) : (
          candidates.slice(0, 40).map(({ m, sq }) => (
            <Pressable
              key={`${sq.id}/${m.id}`}
              onPress={() => {
                tap();
                setPicking(false);
                run(() => side.setDeputy(m.id, m.callsign || 'Связист'));
              }}
              style={({ pressed }) => [styles.squadRow, pressed && { opacity: 0.6 }]}
            >
              <Icon name={m.role === 'radio' ? 'radio-tower' : 'account'} size={20} color={m.role === 'radio' ? C.accent : C.dim} />
              <Text style={[styles.text, { flex: 1 }]} numberOfLines={1}>
                {m.callsign} · {sq.name}
                {m.role === 'radio' ? ' · связист' : ''}
              </Text>
              <Icon name="plus" size={20} color={C.accent} />
            </Pressable>
          ))
        )
      ) : null}
      <Button
        title={picking ? 'Отмена' : 'Назначить связиста штаба'}
        icon={picking ? 'close' : 'account-plus-outline'}
        kind="secondary"
        onPress={() => setPicking((v) => !v)}
      />
    </Card>
  );
}

function SquadCard({
  canDrop,
  sq,
  now,
  editing,
  onEdit,
  onColor,
  onDrop,
}: {
  canDrop: boolean;
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
        {canDrop && (
          <Pressable hitSlop={6} style={styles.iconButton} onPress={onDrop} accessibilityLabel="Отключить отряд">
            <Icon name="link-variant-off" size={18} color={C.dim} />
          </Pressable>
        )}
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
