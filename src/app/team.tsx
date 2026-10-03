import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useEffect, useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { formatClock, timeAgo } from '../lib/geo';
import { inviteUrl } from '../lib/invite';
import { ROLE_ORDER, ROLES, TEAM_COLORS } from '../lib/roles';
import type { Member } from '../lib/types';
import { STALE_MS } from '../map/TacticalMap';
import { pickAvatar } from '../services/avatar';
import * as recordings from '../services/recordings';
import { useSession } from '../state/session';
import { useSide } from '../state/side';
import { QrCode } from '../ui/QrCode';
import { Avatar, Badge, Button, Card, Eyebrow, Icon, KeyboardScroll, RoleIcon, tap, type IconName } from '../ui/components';
import { C, F, R } from '../ui/theme';

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
  const [callsign, setCallsign] = useState(s.callsign);
  const [teamName, setTeamName] = useState('');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<'join' | 'create'>('join');
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [sideCode, setSideCode] = useState('');
  const side = useSide();

  useEffect(() => setCallsign(s.callsign), [s.callsign]);

  const inTeam = Boolean(s.teamId && s.uid);
  const recording = s.team?.recordingId ?? null;
  const callsignDirty = callsign.trim() !== s.callsign;
  const now = Date.now();
  const color = inTeam ? s.teamColor : C.accent;

  const sortedMembers = [...s.members].sort((a, b) => {
    if (a.id === s.uid) return -1;
    if (b.id === s.uid) return 1;
    return ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.callsign.localeCompare(b.callsign);
  });

  const changeAvatar = () => {
    const pick = () =>
      run('avatar', async () => {
        const uri = await pickAvatar();
        if (uri) await s.setAvatar(uri);
      });
    if (!s.avatar) return pick();
    Alert.alert('Аватар', undefined, [
      { text: 'Выбрать другое фото', onPress: pick },
      { text: 'Удалить фото', style: 'destructive', onPress: () => run('avatar', () => s.setAvatar(null)) },
      { text: 'Отмена', style: 'cancel' },
    ]);
  };

  return (
    <KeyboardScroll contentContainerStyle={styles.content} headerOffset={headerHeight}>
      {/* Profile: avatar, callsign, role */}
      <Card style={{ gap: 16 }}>
        <View style={styles.profile}>
          <Pressable onPress={changeAvatar} accessibilityLabel="Сменить аватар">
            <Avatar name={callsign || '?'} color={color} uri={s.avatar} size={64} />
            <View style={[styles.avatarEdit, { backgroundColor: color }]}>
              <Icon name="camera" size={14} color={C.accentInk} />
            </View>
          </Pressable>
          <View style={{ flex: 1, gap: 6 }}>
            <Eyebrow>Позывной</Eyebrow>
            <TextInput
              value={callsign}
              onChangeText={setCallsign}
              placeholder="Например: Гром"
              placeholderTextColor={C.faint}
              maxLength={24}
              style={styles.callsignInput}
              selectionColor={C.accent}
              returnKeyType="done"
              onSubmitEditing={() => callsignDirty && run('cs', () => s.setCallsign(callsign))}
            />
          </View>
          {callsignDirty && (
            <Pressable
              style={styles.saveIcon}
              onPress={() => run('cs', () => s.setCallsign(callsign))}
              accessibilityLabel="Сохранить позывной"
            >
              <Icon name="check" size={22} color={C.accentInk} />
            </Pressable>
          )}
        </View>

        <View style={{ gap: 10 }}>
          <Eyebrow>Роль · так вас видят на карте</Eyebrow>
          <View style={styles.roles}>
            {ROLE_ORDER.map((r) => {
              const selected = r === s.role;
              return (
                <Pressable
                  key={r}
                  onPress={() => {
                    tap();
                    run('role', () => s.setRole(r));
                  }}
                  style={[styles.role, selected && { borderColor: color, backgroundColor: color + '1A' }]}
                >
                  <View style={[styles.rolePin, { backgroundColor: selected ? color : C.bg, borderColor: color }]}>
                    <RoleIcon role={r} size={22} color={selected ? C.accentInk : color} />
                  </View>
                  <Text style={[styles.roleText, selected && { color: C.text }]} numberOfLines={1}>
                    {ROLES[r].title}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Card>

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

          {/* Settings */}
          <Card style={{ gap: 0, paddingVertical: 6 }}>
            <SettingRow
              icon={s.shareLocation ? 'access-point' : 'access-point-off'}
              title="Передавать позицию"
              sub={s.shareLocation ? 'Команда видит вас на карте' : 'Вы скрыты от команды'}
              value={s.shareLocation}
              onChange={(v) => run('share', () => s.setShareLocation(v))}
            />
            <View style={styles.divider} />
            <SettingRow
              icon={s.orderSound ? 'volume-high' : 'volume-off'}
              title="Звук приказов"
              sub={s.orderSound ? 'Вибрация и сигнал' : 'Только вибрация'}
              value={s.orderSound}
              onChange={(v) => run('sound', () => s.setOrderSound(v))}
            />
          </Card>

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

          {/* Roster */}
          <View style={{ gap: 10 }}>
            <Eyebrow style={{ paddingHorizontal: 4 }}>
              Состав · {s.members.length}
              {s.isOwner ? ' · ★ — право отдавать приказы' : ''}
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
                  manage={s.isOwner && m.id !== s.uid}
                  onToggleCommand={() => run('cmd', () => s.setMemberCanCommand(m.id, !m.canCommand))}
                  onKick={() =>
                    Alert.alert('Исключить из команды?', m.callsign, [
                      { text: 'Отмена', style: 'cancel' },
                      { text: 'Исключить', style: 'destructive', onPress: () => run('kick', () => s.kickMember(m.id)) },
                    ])
                  }
                />
              ))}
            </Card>
          </View>

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

function SettingRow({
  icon,
  title,
  sub,
  value,
  onChange,
}: {
  icon: IconName;
  title: string;
  sub: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.switchRow}>
      <View style={[styles.switchIcon, value && { backgroundColor: C.accentSoft }]}>
        <Icon name={icon} size={22} color={value ? C.accent : C.dim} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.sub}>{sub}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: C.accent, false: C.elevated }} thumbColor="#fff" />
    </View>
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
  manage,
  onToggleCommand,
  onKick,
}: {
  m: Member;
  first: boolean;
  me: boolean;
  owner: boolean;
  color: string;
  avatar: string | null | undefined;
  fresh: boolean;
  manage: boolean;
  onToggleCommand: () => void;
  onKick: () => void;
}) {
  const commands = owner || m.canCommand;
  return (
    <View style={[styles.member, !first && styles.memberBorder]}>
      <View>
        <Avatar name={m.callsign} color={color} uri={avatar} size={44} dim={!fresh} />
        <View style={[styles.memberRole, { backgroundColor: color }]}>
          <RoleIcon role={m.role} size={13} color={C.accentInk} />
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
      {manage && (
        <>
          <Pressable
            hitSlop={6}
            accessibilityLabel={m.canCommand ? 'Забрать право приказов' : 'Дать право приказов'}
            style={[styles.iconButton, m.canCommand && { backgroundColor: C.warn }]}
            onPress={() => {
              tap();
              onToggleCommand();
            }}
          >
            <Icon name="star" size={18} color={m.canCommand ? C.accentInk : C.dim} />
          </Pressable>
          <Pressable hitSlop={6} accessibilityLabel="Исключить" style={styles.iconButton} onPress={onKick}>
            <Icon name="account-remove-outline" size={18} color={C.dim} />
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14, paddingBottom: 48, width: '100%', maxWidth: 640, alignSelf: 'center' },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatarEdit: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callsignInput: { color: C.text, fontSize: 22, fontFamily: F.bold, padding: 0 },
  saveIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  role: {
    flexBasis: '30%',
    flexGrow: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: R.md,
    borderWidth: 1.5,
    borderColor: C.line,
    backgroundColor: C.elevated,
  },
  rolePin: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleText: { color: C.dim, fontSize: 12, fontFamily: F.semibold },
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
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  switchIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: C.line },
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
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: C.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
