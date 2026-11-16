import { useHeaderHeight } from 'expo-router/react-navigation';
import { useEffect, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { formatClock } from '../lib/geo';
import { sendSideMessage, subscribeSideChat, type SideMessage } from '../services/sides';
import { useChat } from '../state/chat';
import { useSession } from '../state/session';
import { useSide } from '../state/side';
import { Icon, tap } from '../ui/components';
import { C, F, R } from '../ui/theme';

/**
 * Side chat: the command post (commander and HQ signallers), squad commanders and squad
 * signallers. A long press carries a message into my squad's chat («ретрансляция»), the
 * squad chat's long press carries one back here.
 */
export default function SideChatScreen() {
  const session = useSession();
  const side = useSide();
  const chat = useChat();
  const headerHeight = useHeaderHeight();
  const sideId = side.side?.id ?? side.mySquadSide?.id ?? null;
  const [list, setList] = useState<SideMessage[]>([]);
  const [text, setText] = useState('');
  const allowed = side.isSideCommander || (Boolean(side.mySquadSide) && (session.canCommand || session.role === 'radio'));

  useEffect(() => {
    if (!sideId || !allowed) return;
    return subscribeSideChat(sideId, setList, () => {});
  }, [sideId, allowed]);

  if (!sideId || !allowed || !session.uid) {
    return (
      <View style={[styles.root, styles.empty]}>
        <Icon name="forum-outline" size={44} color={C.faint} />
        <Text style={styles.emptyText}>
          Чат стороны — для штаба, командиров отрядов и связистов отрядов, присоединённых к стороне.
        </Text>
      </View>
    );
  }

  const myTeamName = session.team?.name ?? null;
  const submit = () => {
    const v = text.trim();
    if (!v) return;
    tap();
    setText('');
    sendSideMessage(sideId, {
      uid: session.uid!,
      callsign: session.callsign || 'Связист',
      text: v,
      teamId: session.teamId,
      teamName: side.isSideCommander ? 'Штаб' : myTeamName,
    }).catch((e: Error) => Alert.alert('Не отправилось', e.message));
  };

  const relay = (m: SideMessage) => {
    if (!session.teamId) return;
    Alert.alert('Передать в чат отряда?', m.text, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Передать',
        onPress: () => chat.send(`📡 ${m.teamName ?? 'Сторона'} · ${m.callsign}: ${m.text}`).catch(() => {}),
      },
    ]);
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior="padding" keyboardVerticalOffset={headerHeight}>
      {list.length === 0 && (
        <View style={styles.emptyOverlay} pointerEvents="none">
          <Icon name="forum-outline" size={40} color={C.faint} />
          <Text style={styles.emptyText}>Сообщений пока нет</Text>
        </View>
      )}
      <FlatList
        data={[...list].reverse()}
        inverted
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const mine = item.uid === session.uid;
          return (
            <Pressable
              style={[styles.bubbleRow, mine && { justifyContent: 'flex-end' }]}
              delayLongPress={350}
              disabled={!session.teamId}
              onLongPress={() => relay(item)}
            >
              <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                {!mine && (
                  <Text style={styles.author}>
                    {item.callsign}
                    {item.teamName ? ` · ${item.teamName}` : ''}
                  </Text>
                )}
                {item.relayedFrom && <Text style={styles.via}>передал связист: {item.relayedFrom}</Text>}
                <Text style={[styles.text, mine && { color: C.accentInk }]}>{item.text}</Text>
                <Text style={[styles.time, mine && { color: 'rgba(11,15,12,0.6)' }]}>{formatClock(item.createdAt)}</Text>
              </View>
            </Pressable>
          );
        }}
      />
      <Text style={styles.hint}>Долгое нажатие на сообщение — передать в чат своего отряда.</Text>
      <View style={styles.inputRow}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Сообщение стороне"
          placeholderTextColor={C.faint}
          maxLength={1000}
          multiline
          style={styles.input}
          selectionColor={C.accent}
        />
        <Pressable onPress={submit} style={styles.sendBtn} accessibilityLabel="Отправить">
          <Icon name="send" size={20} color={C.accentInk} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  empty: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  emptyOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 120, alignItems: 'center', justifyContent: 'center', gap: 10 },
  emptyText: { color: C.faint, fontSize: 15, fontFamily: F.regular, textAlign: 'center' },
  listContent: { padding: 12, gap: 6 },
  bubbleRow: { flexDirection: 'row' },
  bubble: { maxWidth: '82%', borderRadius: R.lg, paddingHorizontal: 12, paddingVertical: 8, gap: 2 },
  mine: { backgroundColor: C.accent },
  theirs: { backgroundColor: C.elevated },
  author: { color: C.accent, fontSize: 12, fontFamily: F.semibold },
  via: { color: C.info, fontSize: 11, fontFamily: F.regular },
  text: { color: C.text, fontSize: 15, fontFamily: F.regular, lineHeight: 20 },
  time: { color: C.faint, fontSize: 11, fontFamily: F.mono, alignSelf: 'flex-end' },
  hint: { color: C.faint, fontSize: 12, fontFamily: F.regular, textAlign: 'center', paddingHorizontal: 12 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10 },
  input: {
    flex: 1,
    color: C.text,
    fontSize: 15,
    fontFamily: F.regular,
    backgroundColor: C.elevated,
    borderRadius: R.lg,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxHeight: 120,
  },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
});
