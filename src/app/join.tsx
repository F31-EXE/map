import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { normalizeCode, type Invite } from '../lib/invite';
import { useSession } from '../state/session';
import { useGame } from '../state/game';
import { Button, Card, Eyebrow, Icon } from '../ui/components';
import { C, F } from '../ui/theme';

/**
 * Opened by grimmap://join?team=CODE or ?side=CODE — e.g. when the phone's own camera
 * reads a GrimMap QR. Asks before acting so a stray link can't move anyone silently.
 */
export default function JoinScreen() {
  const params = useLocalSearchParams<{ team?: string; side?: string; hq?: string; dir?: string; sid?: string; d?: string }>();
  const session = useSession();
  const { acceptInvite } = useGame();
  const [busy, setBusy] = useState(false);

  const invite: Invite | null = params.team
    ? { kind: 'team', code: normalizeCode(params.team) }
    : params.side
      ? { kind: 'side', code: normalizeCode(params.side) }
      : params.hq && params.sid
        ? { kind: 'hq', code: normalizeCode(params.hq), sideId: params.sid }
        : params.dir && params.sid && params.d
          ? { kind: 'dir', code: normalizeCode(params.dir), sideId: params.sid, dirId: params.d }
          : null;

  const accept = async () => {
    if (!invite) return;
    setBusy(true);
    try {
      const message = await acceptInvite(invite);
      router.replace(invite.kind === 'hq' ? '/side' : '/team');
      Alert.alert('Готово', message);
    } catch (e) {
      Alert.alert('Не получилось', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!invite) {
    return (
      <View style={styles.root}>
        <Card>
          <Text style={styles.text}>Ссылка-приглашение не распознана.</Text>
        </Card>
      </View>
    );
  }

  const isTeam = invite.kind === 'team';
  const title =
    invite.kind === 'team'
      ? 'Приглашение в отряд'
      : invite.kind === 'hq'
        ? 'Приглашение в штаб стороны'
        : invite.kind === 'dir'
          ? 'Отряд в направление'
          : 'Присоединить отряд к стороне';
  const text =
    invite.kind === 'team'
      ? session.teamId
        ? 'Вы уже в отряде. При вступлении вы перейдёте в новый.'
        : 'Вы появитесь на карте у бойцов этого отряда.'
      : invite.kind === 'hq'
        ? 'Вы войдёте в штаб стороны. Роль — заместитель или командир направления — даст командир стороны.'
        : invite.kind === 'dir'
          ? 'Ваш отряд войдёт в сторону и в направление: командир направления будет видеть его и отдавать приказы.'
          : 'Командир стороны увидит ваш отряд на своей карте и сможет отдавать приказы его командирам.';
  const action =
    invite.kind === 'team' ? 'Вступить' : invite.kind === 'hq' ? 'Войти в штаб' : 'Присоединить отряд';
  return (
    <View style={styles.root}>
      <Card style={{ gap: 16, alignItems: 'center' }}>
        <Icon name={isTeam ? 'account-group' : 'flag-variant'} size={44} color={C.accent} />
        <Eyebrow>{title}</Eyebrow>
        <Text style={styles.code}>{invite.code}</Text>
        <Text style={styles.text}>{text}</Text>
        <Button
          title={action}
          icon="check"
          busy={busy}
          onPress={accept}
          style={{ alignSelf: 'stretch' }}
        />
        <Button title="Отмена" kind="ghost" onPress={() => router.replace('/')} style={{ alignSelf: 'stretch' }} />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, justifyContent: 'center', width: '100%', maxWidth: 520, alignSelf: 'center' },
  code: { color: C.accent, fontSize: 34, fontFamily: F.mono, letterSpacing: 6 },
  text: { color: C.dim, fontSize: 15, lineHeight: 21, fontFamily: F.regular, textAlign: 'center' },
});
