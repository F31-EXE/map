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
import type { DeputyPerm } from '../lib/types';
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

  if (!side.isSideCommander && side.isDirCommander && side.side && side.myDirection) {
    return <DirectionView run={run} busy={busy} />;
  }
  if (!side.isSideCommander && side.inHq && side.side) {
    return (
      <KeyboardScroll contentContainerStyle={styles.content} headerOffset={headerHeight}>
        <Card style={{ gap: 12 }}>
          <View style={styles.inline}>
            <Icon name="account-clock-outline" size={26} color={C.accent} />
            <Text style={styles.title}>Штаб «{side.side.name}»</Text>
          </View>
          <Text style={styles.text}>
            Вы в штабе стороны. Роль — заместитель или командир направления — даст командир стороны или его заместитель.
          </Text>
        </Card>
        <Button title="Чат стороны" icon="forum-outline" kind="secondary" onPress={() => router.push('/side-chat')} />
        <Button
          title="Выйти из штаба"
          kind="danger"
          icon="logout"
          onPress={() => confirmDestructive('Выйти из штаба?', side.side!.name, 'Выйти', () => run(side.leaveHq))}
        />
      </KeyboardScroll>
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
            <Text style={styles.stars}>★★</Text>
            <Text style={styles.cardTitle}>Вы заместитель командира стороны</Text>
          </View>
          <Text style={styles.text}>
            Видите всю карту стороны. Ваши права:{' '}
            {PERMS.filter((p) => side.can(p.k)).map((p) => p.title.toLowerCase()).join(', ') || 'только просмотр'}. Права
            меняет командир стороны.
          </Text>
        </Card>
      )}

      <Button title="Чат стороны" icon="forum-outline" kind="secondary" onPress={() => router.push('/side-chat')} />

      {(side.isSideOwner || side.can('directions')) && <HqCard run={run} />}
      <DirectionsCard run={run} />

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
              canDrop={side.can('squads')}
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

const PERMS: { k: DeputyPerm; title: string }[] = [
  { k: 'orders', title: 'Приказы отрядам' },
  { k: 'game', title: 'Игра: стройка и удары' },
  { k: 'squads', title: 'Отключать отряды' },
  { k: 'directions', title: 'Штаб и направления' },
];
const ALL_PERMS = PERMS.map((p) => p.k);

const newDirId = () => `d${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

/**
 * The side's HQ: invite people with a QR, then give each a role — deputy (with rights,
 * the commander only) or direction commander (the commander, or a deputy with the right).
 */
function HqCard({ run }: { run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const side = useSide();
  const s = side.side!;
  const [code, setCode] = useState<string | null>(s.hqCode ?? null);
  const [showQr, setShowQr] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const dirs = Object.entries(s.directions ?? {});
  const people = side.hq.filter((h) => h.uid !== s.ownerId);

  const makeDirCmd = (uid: string, name: string, dirId: string) => {
    const next = { ...(s.directions ?? {}) };
    // One direction per commander.
    for (const [id, d] of Object.entries(next)) if (d.cmd === uid) next[id] = { ...d, cmd: null, cmdName: null };
    next[dirId] = { ...next[dirId], cmd: uid, cmdName: name };
    return run(() => side.saveDirections(next));
  };
  const dropDirCmd = (uid: string) => {
    const next = { ...(s.directions ?? {}) };
    for (const [id, d] of Object.entries(next)) if (d.cmd === uid) next[id] = { ...d, cmd: null, cmdName: null };
    return run(() => side.saveDirections(next));
  };

  return (
    <Card style={{ gap: 10 }}>
      <Eyebrow>Штаб · {people.length}</Eyebrow>
      <Text style={styles.sub}>
        Пригласите людей в штаб по QR, затем дайте роль: заместитель КС (★★, права выбираете вы) или командир направления
        (★, ведёт несколько отрядов).
      </Text>
      <Button
        title={showQr ? 'Скрыть QR штаба' : 'Пригласить в штаб'}
        icon="qrcode"
        kind="secondary"
        onPress={() =>
          run(async () => {
            if (!showQr && !code) setCode(await side.hqCode());
            setShowQr((v) => !v);
          })
        }
      />
      {showQr && code && (
        <View style={{ alignItems: 'center', gap: 8 }}>
          <QrCode value={inviteUrl({ kind: 'hq', code, sideId: s.id })} size={200} />
          <Text style={styles.sub}>Сканировать в GrimMap: «Сканировать QR». Человек попадёт в штаб без роли.</Text>
        </View>
      )}
      {people.map((h) => {
        const stars = side.starsOf(h.uid);
        const dep = s.deputies?.[h.uid];
        const dirOf = dirs.find(([, d]) => d.cmd === h.uid);
        return (
          <View key={h.uid} style={styles.person}>
            <Pressable style={styles.squadRow} onPress={() => setOpen(open === h.uid ? null : h.uid)}>
              <Text style={styles.stars}>{stars ? '★'.repeat(stars) : '·'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {h.callsign}
                </Text>
                <Text style={styles.sub} numberOfLines={1}>
                  {dep ? 'заместитель КС' : dirOf ? `командир направления «${dirOf[1].name}»` : 'без роли'}
                </Text>
              </View>
              <Icon name={open === h.uid ? 'chevron-up' : 'chevron-down'} size={20} color={C.dim} />
            </Pressable>
            {open === h.uid && (
              <View style={{ gap: 8 }}>
                {side.isSideOwner && (
                  <View style={styles.chipRow}>
                    <RoleChip
                      on={Boolean(dep)}
                      text="★★ Заместитель"
                      onPress={() =>
                        run(async () => {
                          if (dep) await side.setDeputy(h.uid, null);
                          else {
                            if (dirOf) await dropDirCmd(h.uid);
                            await side.setDeputy(h.uid, { name: h.callsign, perms: ALL_PERMS });
                          }
                        })
                      }
                    />
                  </View>
                )}
                {dep && side.isSideOwner && (
                  <View style={styles.chipRow}>
                    {PERMS.map((p) => {
                      const on = dep.perms.includes(p.k);
                      return (
                        <RoleChip
                          key={p.k}
                          on={on}
                          small
                          text={p.title}
                          onPress={() =>
                            run(() =>
                              side.setDeputy(h.uid, {
                                name: dep.name,
                                perms: on ? dep.perms.filter((x) => x !== p.k) : [...dep.perms, p.k],
                              })
                            )
                          }
                        />
                      );
                    })}
                  </View>
                )}
                {!dep && (
                  <View style={styles.chipRow}>
                    {dirs.map(([id, d]) => (
                      <RoleChip
                        key={id}
                        on={d.cmd === h.uid}
                        text={`★ ${d.name}`}
                        onPress={() => (d.cmd === h.uid ? dropDirCmd(h.uid) : makeDirCmd(h.uid, h.callsign, id))}
                      />
                    ))}
                    {dirs.length === 0 && <Text style={styles.sub}>Создайте направление ниже, чтобы назначить командира.</Text>}
                  </View>
                )}
              </View>
            )}
          </View>
        );
      })}
    </Card>
  );
}

/** Directions: each led by its commander, with the squads that joined it by its QR. */
function DirectionsCard({ run }: { run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const side = useSide();
  const s = side.side!;
  const [name, setName] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const dirs = Object.entries(s.directions ?? {});
  const canEdit = side.can('directions');
  if (!dirs.length && !canEdit) return null;
  return (
    <Card style={{ gap: 10 }}>
      <Eyebrow>Направления · {dirs.length}</Eyebrow>
      {dirs.map(([id, d]) => {
        const squads = side.squads.filter((sq) => sq.dirId === id);
        return (
          <View key={id} style={styles.person}>
            <View style={styles.squadRow}>
              <Text style={styles.stars}>★</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {d.name}
                </Text>
                <Text style={styles.sub} numberOfLines={2}>
                  {d.cmdName ? `командир: ${d.cmdName}` : 'командир не назначен'} ·{' '}
                  {squads.length ? squads.map((sq) => sq.name).join(', ') : 'отрядов нет'}
                </Text>
              </View>
              <Pressable hitSlop={8} onPress={() => setQr(qr === id ? null : id)} accessibilityLabel="QR направления">
                <Icon name="qrcode" size={20} color={C.dim} />
              </Pressable>
              {canEdit && (
                <Pressable
                  hitSlop={8}
                  onPress={() =>
                    confirmDestructive(`Убрать направление «${d.name}»?`, 'Отряды останутся на стороне.', 'Убрать', () =>
                      run(async () => {
                        const { [id]: _, ...rest } = s.directions ?? {};
                        await side.saveDirections(rest);
                        await Promise.all(squads.map((sq) => side.releaseSquad(sq.id).catch(() => {})));
                      })
                    )
                  }
                  accessibilityLabel="Убрать направление"
                >
                  <Icon name="delete-outline" size={20} color={C.dim} />
                </Pressable>
              )}
            </View>
            {qr === id && (
              <View style={{ alignItems: 'center', gap: 8 }}>
                <QrCode value={inviteUrl({ kind: 'dir', code: d.code, sideId: s.id, dirId: id })} size={200} />
                <Text style={styles.sub}>Командир отряда сканирует — отряд входит в сторону и в это направление.</Text>
              </View>
            )}
          </View>
        );
      })}
      {canEdit && (
        <>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Новое направление, например «Север»"
            placeholderTextColor={C.faint}
            maxLength={30}
            style={styles.input}
            selectionColor={C.accent}
          />
          <Button
            title="Создать направление"
            icon="sign-direction-plus"
            kind="secondary"
            onPress={() =>
              run(async () => {
                if (!name.trim()) throw new Error('Введите название направления');
                await side.saveDirections({
                  ...(s.directions ?? {}),
                  [newDirId()]: { name: name.trim(), cmd: null, cmdName: null, code: randomInviteCode() },
                });
                setName('');
              })
            }
          />
        </>
      )}
    </Card>
  );
}

/** A direction commander's own screen: the QR for squad leaders and the squads. */
function DirectionView({ run, busy }: { run: (fn: () => Promise<unknown>) => Promise<void>; busy: boolean }) {
  const side = useSide();
  const headerHeight = useHeaderHeight();
  const s = side.side!;
  const d = side.myDirection!;
  const now = Date.now();
  return (
    <KeyboardScroll contentContainerStyle={styles.content} headerOffset={headerHeight}>
      <Card style={{ gap: 14, alignItems: 'center' }}>
        <View style={{ alignSelf: 'stretch' }}>
          <Eyebrow>★ Командир направления · {s.name}</Eyebrow>
          <Text style={styles.title}>{d.name}</Text>
          <Text style={styles.sub}>
            {side.squads.length} отр. · {side.squads.reduce((n, sq) => n + sq.members.length, 0)} бойцов
          </Text>
        </View>
        <QrCode value={inviteUrl({ kind: 'dir', code: d.code, sideId: s.id, dirId: d.id })} size={200} />
        <Text style={styles.text}>Командир отряда сканирует этот код — отряд входит в ваше направление.</Text>
      </Card>
      <Button title="Чат стороны" icon="forum-outline" kind="secondary" onPress={() => router.push('/side-chat')} />
      <View style={{ gap: 10 }}>
        <Eyebrow style={{ paddingHorizontal: 4 }}>Отряды направления</Eyebrow>
        {side.squads.length === 0 ? (
          <Card>
            <Text style={styles.text}>Пока ни один отряд не вошёл в направление.</Text>
          </Card>
        ) : (
          side.squads.map((sq) => (
            <SquadCard
              key={sq.id}
              canDrop
              sq={sq}
              now={now}
              editing={false}
              onEdit={() => {}}
              onColor={() => {}}
              onDrop={() =>
                confirmDestructive('Отпустить отряд из направления?', `${sq.name} останется на стороне.`, 'Отпустить', () =>
                  run(() => side.releaseSquad(sq.id))
                )
              }
            />
          ))
        )}
      </View>
      {busy && <Text style={styles.sub}>…</Text>}
    </KeyboardScroll>
  );
}

function RoleChip({ on, text, small, onPress }: { on: boolean; text: string; small?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
      style={[styles.roleChip, on && styles.roleChipOn, small && { height: 30 }]}
    >
      <Text style={[styles.roleChipText, on && { color: C.accentInk }, small && { fontSize: 12 }]}>{text}</Text>
    </Pressable>
  );
}

const randomInviteCode = () => {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += A[Math.floor(Math.random() * A.length)];
  return out;
};

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
  stars: { color: '#FFC83D', fontSize: 16, fontFamily: F.bold, minWidth: 30 },
  person: { gap: 8, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  roleChip: {
    paddingHorizontal: 12,
    height: 34,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.elevated,
    justifyContent: 'center',
  },
  roleChipOn: { backgroundColor: C.accent, borderColor: C.accent },
  roleChipText: { color: C.text, fontSize: 13, fontFamily: F.semibold },
});
