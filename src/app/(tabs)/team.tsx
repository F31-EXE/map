import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { formatClock, timeAgo } from '../../lib/geo';
import { inviteUrl } from '../../lib/invite';
import { ROLE_ORDER, ROLES, TEAM_COLORS, type RoleId } from '../../lib/roles';
import { STATUSES } from '../../lib/status';
import type { Member, MemberStatus } from '../../lib/types';
import { STALE_MS } from '../../map/TacticalMap';
import * as recordings from '../../services/recordings';
import { useSession } from '../../state/session';
import { useSide } from '../../state/side';
import { confirmDestructive } from '../../ui/confirm';
import { QrCode } from '../../ui/QrCode';
import { Avatar, Badge, Button, Card, Eyebrow, Icon, KeyboardScroll, RoleIcon, Sheet, tap } from '../../ui/components';
import { RolePicker } from '../../ui/RolePicker';
import { StatusPicker, StatusTag } from '../../ui/StatusPicker';
import { C, F, R } from '../../ui/theme';

function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      Alert.alert('Ошибка', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

export default function TeamScreen() {
  const s = useSession();
  const headerHeight = useHeaderHeight();
  const { busy, run } = useAction();
  const [teamName, setTeamName] = useState('');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<'join' | 'create'>('join');
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [sideCode, setSideCode] = useState('');
  const [managing, setManaging] = useState<string | null>(null);
  const side = useSide();

  const inTeam = Boolean(s.teamId && s.uid);
  const recording = s.team?.recordingId ?? null;
  const now = Date.now();
  const color = inTeam ? s.teamColor : C.accent;
  const teamMarkerCount = s.markers.filter((m) => !m.personal && side.canDelete(m)).length;

  // Squad ranks (see src/lib/ranks.ts): creator 3, command rights 2, fighter 1.
  const memberRank = (m: Member) => (m.id === s.team?.ownerId ? 3 : m.canCommand ? 2 : 1);
  const managed = s.members.find((m) => m.id === managing) ?? null;
  const canManageAny = s.members.some((m) => m.id !== s.uid && side.myRank > memberRank(m));

  const sortedMembers = [...s.members].sort((a, b) => {
    if (a.id === s.uid) return -1;
    if (b.id === s.uid) return 1;
    return ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.callsign.localeCompare(b.callsign);
  });

  return (
    <KeyboardScroll contentContainerStyle={styles.content} headerOffset={headerHeight}>
      {!s.callsign && (
        <Pressable onPress={() => router.navigate('/settings')}>
          <Card style={[styles.hint]}>
            <Icon name="account-edit-outline" size={22} color={C.warn} />
            <Text style={[styles.text, { flex: 1 }]}>Сначала задайте позывной и роль во вкладке «Настройки».</Text>
            <Icon name="chevron-right" size={20} color={C.faint} />
          </Card>
        </Pressable>
      )}

      {!s.firebaseEnabled ? (
        <Card>
          <View style={styles.inlineTitle}>
            <Icon name="cloud-off-outline" size={22} color={C.warn} />
            <Text style={styles.cardTitle}>Сервер не настроен</Text>
          </View>
          <Text style={styles.text}>
            Карта, импорт карт полигона и личные метки работают и без сервера. Чтобы видеть товарищей,
            заполните настройки Firebase в файле .env (см. README).
          </Text>
        </Card>
      ) : !s.uid ? (
        <Card>
          <Text style={styles.text}>{s.authError ?? 'Подключаемся к серверу…'}</Text>
        </Card>
      ) : !inTeam ? (
        <Card style={{ gap: 16 }}>
          <View style={styles.segment}>
            {(['join', 'create'] as const).map((m) => (
              <Pressable key={m} onPress={() => setMode(m)} style={[styles.segmentItem, mode === m && styles.segmentActive]}>
                <Text style={[styles.segmentText, mode === m && { color: C.accentInk }]}>
                  {m === 'join' ? 'Вступить' : 'Создать'}
                </Text>
              </Pressable>
            ))}
          </View>

          {mode === 'join' ? (
            <>
              <Text style={styles.text}>Введите код, который вам продиктовал командир.</Text>
              <TextInput
                value={code}
                onChangeText={(t) => setCode(t.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                placeholder="K7QX2M"
                placeholderTextColor={C.faint}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={6}
                style={styles.codeInput}
                selectionColor={C.accent}
              />
              <Button
                title="Вступить в команду"
                icon="login"
                disabled={code.length < 6}
                busy={busy === 'join'}
                onPress={() => run('join', () => s.joinTeam(code))}
              />
              <Button title="Сканировать QR отряда" icon="qrcode-scan" kind="secondary" onPress={() => router.push('/scan')} />
            </>
          ) : (
            <>
              <Text style={styles.text}>
                Вы станете создателем команды: выбираете её цвет и раздаёте право отдавать приказы.
              </Text>
              <TextInput
                value={teamName}
                onChangeText={setTeamName}
                placeholder="Название, например «Отряд Север»"
                placeholderTextColor={C.faint}
                maxLength={40}
                style={styles.input}
                selectionColor={C.accent}
              />
              <Button
                title="Создать команду"
                icon="flag-plus"
                busy={busy === 'create'}
                onPress={() => run('create', () => s.createTeam(teamName))}
              />
            </>
          )}
        </Card>
      ) : (
        <>
          {/* My game state */}
          <Card style={{ gap: 10 }}>
            <Eyebrow>Мой статус</Eyebrow>
            <StatusPicker value={s.status} onPick={(st) => run('status', () => s.setStatus(st))} />
          </Card>

          {/* Roster */}
          <View style={{ gap: 10 }}>
            <Eyebrow style={{ paddingHorizontal: 4 }}>
              Состав · {s.members.length} · жив {s.members.filter((m) => m.status === 'alive').length} · убит{' '}
              {s.members.filter((m) => m.status === 'dead').length}
            </Eyebrow>
            <Card style={{ gap: 0, paddingVertical: 6 }}>
              {sortedMembers.map((m, i) => (
                <MemberRow
                  key={m.id}
                  m={m}
                  first={i === 0}
                  me={m.id === s.uid}
                  owner={m.id === s.team?.ownerId}
                  color={color}
                  avatar={m.id === s.uid ? s.avatar : s.avatars[m.id]}
                  fresh={m.lat != null && m.updatedAt != null && now - m.updatedAt < STALE_MS}
                  onPress={() => setManaging(m.id)}
                />
              ))}
            </Card>
            {canManageAny && (
              <Text style={[styles.sub, { paddingHorizontal: 4 }]}>
                Нажмите на бойца, чтобы сменить роль или статус{s.isOwner ? ', выдать право приказов' : ''}.
              </Text>
            )}
          </View>

          {managed && (
            <MemberSheet
              m={managed}
              color={color}
              me={managed.id === s.uid}
              avatar={managed.id === s.uid ? s.avatar : s.avatars[managed.id]}
              canEdit={managed.id === s.uid || side.myRank > memberRank(managed)}
              isOwner={s.isOwner}
              onClose={() => setManaging(null)}
              onRole={(r) => run('mrole', () => s.setMemberRole(managed.id, r))}
              onStatus={(st) => run('mstatus', () => s.setMemberStatus(managed.id, st))}
              onToggleCommand={() => run('cmd', () => s.setMemberCanCommand(managed.id, !managed.canCommand))}
              onKick={() =>
                confirmDestructive('Исключить из отряда?', managed.callsign, 'Исключить', () => {
                  setManaging(null);
                  run('kick', () => s.kickMember(managed.id));
                })
              }
            />
          )}

          {/* Team, invite code, color */}
          <Card style={{ gap: 14 }}>
            <View style={styles.teamHeader}>
              <View style={[styles.teamSwatch, { backgroundColor: color }]} />
              <View style={{ flex: 1 }}>
                <Eyebrow>Команда</Eyebrow>
                <Text style={styles.teamName} numberOfLines={1}>
                  {s.team?.name ?? '…'}
                </Text>
              </View>
              {s.isOwner ? (
                <Badge text="СОЗДАТЕЛЬ" color={C.accent} />
              ) : s.canCommand ? (
                <Badge text="ОТДАЁТ ПРИКАЗЫ" color={C.warn} />
              ) : null}
            </View>
            <View style={styles.codeRow}>
              {(s.team?.code ?? '······').split('').map((ch, i) => (
                <View key={i} style={[styles.codeCell, { borderColor: color + '40' }]}>
                  <Text style={[styles.codeChar, { color }]}>{ch}</Text>
                </View>
              ))}
            </View>
            <View style={styles.row}>
              <Button
                title={copied ? 'Скопировано' : 'Копировать'}
                icon={copied ? 'check' : 'content-copy'}
                kind="secondary"
                style={{ flex: 1 }}
                onPress={() => {
                  if (!s.team) return;
                  Clipboard.setStringAsync(s.team.code);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              />
              <Button
                title="Пригласить"
                icon="share-variant"
                style={{ flex: 1 }}
                onPress={() =>
                  s.team &&
                  Share.share({
                    message: `Вступай в отряд «${s.team.name}» в GrimMap. Код: ${s.team.code}\n${inviteUrl({ kind: 'team', code: s.team.code })}`,
                  })
                }
              />
            </View>
            <Button
              title={showQr ? 'Скрыть QR' : 'Показать QR для вступления'}
              icon="qrcode"
              kind="ghost"
              onPress={() => setShowQr(!showQr)}
            />
            {showQr && s.team && (
              <View style={{ alignItems: 'center', gap: 8 }}>
                <QrCode value={inviteUrl({ kind: 'team', code: s.team.code })} size={220} />
                <Text style={styles.sub}>Боец сканирует в GrimMap: Команда → «Сканировать QR отряда»</Text>
              </View>
            )}
            {s.isOwner && (
              <View style={{ gap: 10 }}>
                <Eyebrow>Цвет команды на карте</Eyebrow>
                <View style={styles.palette}>
                  {TEAM_COLORS.map((c) => (
                    <Pressable
                      key={c}
                      accessibilityLabel={`Цвет ${c}`}
                      onPress={() => {
                        tap();
                        run('color', () => s.setTeamColor(c));
                      }}
                      style={[styles.colorDot, { backgroundColor: c }, c === color && styles.colorDotActive]}
                    >
                      {c === color && <Icon name="check" size={18} color={C.accentInk} />}
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
            {s.teamError && <Text style={styles.error}>{s.teamError}</Text>}
          </Card>

          {/* Side membership */}
          {(s.isOwner || side.mySquadSide) && (
            <Card style={{ gap: 12 }}>
              <View style={styles.inlineTitle}>
                <Icon name="flag-variant" size={20} color={side.mySquadSide ? C.accent : C.dim} />
                <Text style={styles.cardTitle}>
                  {side.mySquadSide ? `Сторона «${side.mySquadSide.name}»` : 'Сторона'}
                </Text>
              </View>
              {side.mySquadSide ? (
                <>
                  <Text style={styles.text}>
                    Отряд в составе стороны: её командир видит отряд на карте и отдаёт приказы командирам.
                  </Text>
                  {s.isOwner && (
                    <Button
                      title="Отсоединить отряд"
                      kind="secondary"
                      icon="link-variant-off"
                      busy={busy === 'detach'}
                      onPress={() => run('detach', side.detachMySquad)}
                    />
                  )}
                </>
              ) : (
                <>
                  <Text style={styles.text}>Отряд не в составе стороны. Код или QR даёт командир стороны.</Text>
                  <TextInput
                    value={sideCode}
                    onChangeText={(t) => setSideCode(t.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                    placeholder="Код стороны"
                    placeholderTextColor={C.faint}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={6}
                    style={styles.input}
                    selectionColor={C.accent}
                  />
                  <View style={styles.row}>
                    <Button
                      title="Сканировать"
                      icon="qrcode-scan"
                      kind="secondary"
                      style={{ flex: 1 }}
                      onPress={() => router.push('/scan')}
                    />
                    <Button
                      title="Присоединить"
                      icon="link-variant"
                      style={{ flex: 1 }}
                      disabled={sideCode.length < 6}
                      busy={busy === 'attach'}
                      onPress={() => run('attach', () => side.attachMySquad(sideCode))}
                    />
                  </View>
                </>
              )}
            </Card>
          )}

          {s.isOwner && (
            <Card style={{ gap: 12 }}>
              <View style={styles.inlineTitle}>
                <Icon name="map-marker-remove-outline" size={20} color={C.dim} />
                <Text style={[styles.cardTitle, { flex: 1 }]}>Метки отряда</Text>
                <Badge text={String(teamMarkerCount)} />
              </View>
              <Text style={styles.text}>
                Очистить карту перед новой игрой: удалит метки, приказы и стрелки всех бойцов отряда.
                {side.mySquadSide ? ' Приказы командира стороны останутся.' : ''}
              </Text>
              <Button
                title="Удалить все метки"
                icon="delete-sweep-outline"
                kind="danger"
                busy={busy === 'clear'}
                disabled={teamMarkerCount === 0}
                onPress={() =>
                  confirmDestructive(
                    'Удалить все метки отряда?',
                    'Они исчезнут у всех бойцов. Отменить нельзя.',
                    'Удалить',
                    () => run('clear', async () => void (await s.clearTeamMarkers(side.canDelete)))
                  )
                }
              />
            </Card>
          )}

          {/* Movement recording */}
          <Card style={{ gap: 12 }}>
            <View style={styles.inlineTitle}>
              <Icon
                name={recording ? 'record-circle' : 'map-marker-path'}
                size={20}
                color={recording ? C.danger : C.dim}
              />
              <Text style={[styles.cardTitle, { flex: 1 }]}>Запись игры</Text>
              {recording && <Badge text="REC" color={C.danger} />}
            </View>
            <Text style={styles.text}>
              {recording
                ? 'Идёт запись передвижений всех бойцов отряда. Анализ будет доступен после остановки.'
                : 'Записывает, где ходили бойцы. После игры — маршруты и тепловая карта.'}
            </Text>
            <View style={styles.row}>
              {s.canCommand && (
                <Button
                  title={recording ? 'Остановить' : 'Начать запись'}
                  icon={recording ? 'stop' : 'record'}
                  kind={recording ? 'danger' : 'primary'}
                  busy={busy === 'rec'}
                  style={{ flex: 1 }}
                  onPress={() =>
                    run('rec', async () => {
                      if (!s.teamId || !s.uid) return;
                      if (recording) await recordings.stopRecording(s.teamId, recording);
                      else await recordings.startRecording(s.teamId, s.uid, `Игра ${new Date().toLocaleDateString('ru-RU')} ${formatClock(Date.now())}`);
                    })
                  }
                />
              )}
              <Button
                title="Записи игр"
                icon="history"
                kind="secondary"
                style={{ flex: 1 }}
                onPress={() => router.push('/replay')}
              />
            </View>
          </Card>

          <Button
            title="Покинуть команду"
            kind="danger"
            icon="logout"
            busy={busy === 'leave'}
            onPress={() =>
              Alert.alert('Покинуть команду?', 'Вернуться можно по коду.', [
                { text: 'Отмена', style: 'cancel' },
                { text: 'Покинуть', style: 'destructive', onPress: () => run('leave', s.leaveTeam) },
              ])
            }
          />
        </>
      )}

      {s.firebaseEnabled && s.uid && (
        <Pressable onPress={() => router.push('/side')}>
          <Card style={styles.sideEntry}>
            <View style={[styles.switchIcon, side.isSideCommander && { backgroundColor: C.accentSoft }]}>
              <Icon name="flag-variant" size={22} color={side.isSideCommander ? C.accent : C.dim} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Командование стороной</Text>
              <Text style={styles.sub}>
                {side.isSideCommander
                  ? `«${side.side?.name ?? ''}» · ${side.squads.length} отр.`
                  : 'Объединить отряды и командовать ими'}
              </Text>
            </View>
            <Icon name="chevron-right" size={20} color={C.faint} />
          </Card>
        </Pressable>
      )}
    </KeyboardScroll>
  );
}

function MemberRow({
  m,
  first,
  me,
  owner,
  color,
  avatar,
  fresh,
  onPress,
}: {
  m: Member;
  first: boolean;
  me: boolean;
  owner: boolean;
  color: string;
  avatar: string | null | undefined;
  fresh: boolean;
  onPress: () => void;
}) {
  const commands = owner || m.canCommand;
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [styles.member, !first && styles.memberBorder, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.statusBar, { backgroundColor: fresh ? STATUSES[m.status].color : C.faint }]} />
      <View>
        <Avatar name={m.callsign} color={color} uri={avatar} size={44} dim={!fresh || m.status !== 'alive'} />
        <View style={[styles.memberRole, { backgroundColor: color }]}>
          <RoleIcon role={m.role} size={14} color={C.accentInk} />
        </View>
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.memberNameRow}>
          <Text style={styles.memberName} numberOfLines={1}>
            {m.callsign}
          </Text>
          {me && <Badge text="Я" />}
          {commands && <Icon name="star" size={15} color={C.warn} />}
        </View>
        <Text style={styles.sub} numberOfLines={1}>
          {ROLES[m.role].title} ·{' '}
          {m.lat == null
            ? 'позиция скрыта'
            : m.updatedAt
              ? `${fresh ? 'на связи' : 'был'} ${timeAgo(m.updatedAt)}`
              : '—'}
        </Text>
      </View>
      <StatusTag status={m.status} offline={!fresh} />
    </Pressable>
  );
}

/** Fighter card: role and status (for superiors), command rights and kick (creator). */
function MemberSheet({
  m,
  color,
  me,
  avatar,
  canEdit,
  isOwner,
  onClose,
  onRole,
  onStatus,
  onToggleCommand,
  onKick,
}: {
  m: Member;
  color: string;
  me: boolean;
  avatar: string | null | undefined;
  canEdit: boolean;
  isOwner: boolean;
  onClose: () => void;
  onRole: (r: RoleId) => void;
  onStatus: (st: MemberStatus) => void;
  onToggleCommand: () => void;
  onKick: () => void;
}) {
  return (
    <Sheet visible onClose={onClose}>
      <View style={styles.sheetHead}>
        <Avatar name={m.callsign} color={color} uri={avatar} size={52} />
        <View style={{ flex: 1 }}>
          <Text style={styles.teamName} numberOfLines={1}>
            {m.callsign}
          </Text>
          <Text style={styles.sub}>{ROLES[m.role].title}</Text>
        </View>
        <RoleIcon role={m.role} size={44} color={color} framed />
      </View>
      {canEdit ? (
        <>
          <Eyebrow>Статус</Eyebrow>
          <StatusPicker value={m.status} onPick={onStatus} />
          <Eyebrow>Роль</Eyebrow>
          <RolePicker value={m.role} color={color} onPick={onRole} />
        </>
      ) : (
        <Text style={styles.text}>Менять роль и статус может только вышестоящий командир.</Text>
      )}
      {isOwner && !me && (
        <View style={styles.row}>
          <Button
            title={m.canCommand ? 'Забрать приказы' : 'Дать право приказов'}
            icon="star"
            kind={m.canCommand ? 'secondary' : 'primary'}
            style={{ flex: 1 }}
            onPress={onToggleCommand}
          />
          <Button title="Исключить" icon="account-remove-outline" kind="danger" onPress={onKick} />
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14, paddingBottom: 48, width: '100%', maxWidth: 640, alignSelf: 'center' },
  inlineTitle: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTitle: { color: C.text, fontSize: 16, fontFamily: F.semibold },
  text: { color: C.dim, fontSize: 15, lineHeight: 21, fontFamily: F.regular },
  sub: { color: C.dim, fontSize: 13, fontFamily: F.regular, marginTop: 1 },
  error: { color: C.danger, fontSize: 14, fontFamily: F.regular },
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
  codeInput: {
    backgroundColor: C.elevated,
    color: C.accent,
    borderRadius: R.md,
    height: 64,
    borderWidth: 1,
    borderColor: C.line,
    fontSize: 30,
    fontFamily: F.mono,
    letterSpacing: 10,
    textAlign: 'center',
  },
  segment: { flexDirection: 'row', backgroundColor: C.elevated, borderRadius: R.md, padding: 4 },
  segmentItem: { flex: 1, height: 40, borderRadius: R.sm, alignItems: 'center', justifyContent: 'center' },
  segmentActive: { backgroundColor: C.accent },
  segmentText: { color: C.dim, fontSize: 15, fontFamily: F.semibold },
  teamHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  teamSwatch: { width: 10, alignSelf: 'stretch', borderRadius: 5 },
  teamName: { color: C.text, fontSize: 24, fontFamily: F.bold, marginTop: 2 },
  codeRow: { flexDirection: 'row', gap: 6 },
  codeCell: {
    flex: 1,
    aspectRatio: 0.82,
    maxHeight: 76,
    borderRadius: R.sm,
    backgroundColor: C.elevated,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeChar: { fontSize: 28, fontFamily: F.mono },
  row: { flexDirection: 'row', gap: 10 },
  palette: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  colorDot: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorDotActive: { borderColor: C.text },
  switchIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: C.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideEntry: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  member: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  memberBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  memberRole: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  memberName: { color: C.text, fontSize: 16, fontFamily: F.semibold, flexShrink: 1 },
  statusBar: { width: 3, alignSelf: 'stretch', borderRadius: 2, marginVertical: 2 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 12, borderColor: C.warn + '66' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 14 },
});
