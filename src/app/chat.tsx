import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatClock } from '../lib/geo';
import { MAX_MESSAGE, type ChatMessage } from '../services/chat';
import { useChat } from '../state/chat';
import { useSession } from '../state/session';
import { Icon, tap } from '../ui/components';
import { C, F, R } from '../ui/theme';

/** One-tap phrases for when there's no time to type. */
const QUICK = ['Контакт!', 'Ранен', 'Нужна помощь', 'Иду', 'На позиции', 'Отходим', 'Чисто', 'Патроны!'];

export default function ChatScreen() {
  const { messages, markRead, send } = useChat();
  const { uid, teamId, teamColor } = useSession();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const list = useRef<FlatList<ChatMessage>>(null);

  // Everything visible counts as read.
  useEffect(() => {
    markRead();
  }, [messages, markRead]);

  const submit = (value: string) => {
    if (!value.trim()) return;
    tap();
    send(value);
    setText('');
  };

  if (!teamId) {
    return (
      <View style={[styles.root, styles.empty]}>
        <Icon name="chat-outline" size={44} color={C.faint} />
        <Text style={styles.emptyText}>Чат доступен, когда вы в отряде</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <FlatList
        ref={list}
        data={[...messages].reverse()}
        inverted
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={[styles.empty, { transform: [{ scaleY: -1 }] }]}>
            <Icon name="chat-outline" size={40} color={C.faint} />
            <Text style={styles.emptyText}>Сообщений пока нет</Text>
          </View>
        }
        renderItem={({ item, index }) => {
          const mine = item.uid === uid;
          const older = [...messages].reverse()[index + 1];
          const showName = !mine && (!older || older.uid !== item.uid);
          return (
            <View style={[styles.bubbleRow, mine && { justifyContent: 'flex-end' }]}>
              <View
                style={[
                  styles.bubble,
                  mine ? [styles.mine, { backgroundColor: teamColor }] : styles.theirs,
                ]}
              >
                {showName && <Text style={[styles.author, { color: teamColor }]}>{item.callsign}</Text>}
                <Text style={[styles.text, mine && { color: C.accentInk }]}>{item.text}</Text>
                <View style={styles.meta}>
                  <Text style={[styles.time, mine && { color: 'rgba(11,15,12,0.6)' }]}>
                    {formatClock(item.createdAt)}
                  </Text>
                  {mine && (
                    <Icon
                      name={item.pending ? 'clock-outline' : 'check'}
                      size={13}
                      color="rgba(11,15,12,0.6)"
                    />
                  )}
                </View>
              </View>
            </View>
          );
        }}
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.quickBar}
        contentContainerStyle={styles.quick}
        keyboardShouldPersistTaps="always"
      >
        {QUICK.map((q) => (
          <Pressable key={q} style={styles.chip} onPress={() => submit(q)}>
            <Text style={styles.chipText}>{q}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={[styles.inputRow, { paddingBottom: insets.bottom + 10 }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Сообщение отряду"
          placeholderTextColor={C.faint}
          maxLength={MAX_MESSAGE}
          multiline
          style={styles.input}
          selectionColor={C.accent}
        />
        <Pressable
          accessibilityLabel="Отправить"
          disabled={!text.trim()}
          onPress={() => submit(text)}
          style={[styles.send, !text.trim() && { opacity: 0.4 }]}
        >
          <Icon name="send" size={20} color={C.accentInk} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  listContent: { padding: 12, gap: 6, flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  emptyText: { color: C.faint, fontSize: 15, fontFamily: F.regular },
  bubbleRow: { flexDirection: 'row' },
  bubble: { maxWidth: '80%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, gap: 2 },
  mine: { borderBottomRightRadius: 4 },
  theirs: { backgroundColor: C.elevated, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: C.line },
  author: { fontSize: 12, fontFamily: F.bold },
  text: { color: C.text, fontSize: 16, fontFamily: F.regular, lineHeight: 21 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end' },
  time: { color: C.faint, fontSize: 11, fontFamily: F.mono },
  quickBar: { flexGrow: 0, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  quick: { gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  chip: {
    paddingHorizontal: 14,
    height: 34,
    borderRadius: R.pill,
    backgroundColor: C.elevated,
    borderWidth: 1,
    borderColor: C.lineStrong,
    justifyContent: 'center',
  },
  chipText: { color: C.text, fontSize: 14, fontFamily: F.semibold },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 4 },
  input: {
    flex: 1,
    minHeight: 46,
    maxHeight: 120,
    backgroundColor: C.elevated,
    color: C.text,
    borderRadius: 23,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    borderWidth: 1,
    borderColor: C.line,
    fontSize: 16,
    fontFamily: F.regular,
  },
  send: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
