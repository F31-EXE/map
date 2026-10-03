import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { loadJson, saveJson } from '../lib/storage';
import { sendMessage, subscribeMessages, type ChatMessage } from '../services/chat';
import { useSession } from './session';

type Chat = {
  messages: ChatMessage[];
  unread: number;
  /** Call while the chat is on screen. */
  markRead: () => void;
  send: (text: string) => Promise<void>;
};

const Ctx = createContext<Chat | null>(null);

export function useChat(): Chat {
  const v = useContext(Ctx);
  if (!v) throw new Error('useChat must be used inside <ChatProvider>');
  return v;
}

const readKey = (teamId: string) => `tacmap.chatRead.${teamId}`;

export function ChatProvider({ children }: { children: ReactNode }) {
  const { teamId, uid, callsign } = useSession();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [readAt, setReadAt] = useState(0);

  useEffect(() => {
    setMessages([]);
    if (!teamId || !uid) return;
    loadJson<number>(readKey(teamId), 0).then(setReadAt);
    return subscribeMessages(teamId, setMessages, () => {});
  }, [teamId, uid]);

  const unread = useMemo(
    () => messages.filter((m) => m.uid !== uid && m.createdAt > readAt).length,
    [messages, uid, readAt]
  );

  const markRead = useCallback(() => {
    if (!teamId || !messages.length) return;
    const last = messages[messages.length - 1].createdAt;
    if (last <= readAt) return;
    setReadAt(last);
    saveJson(readKey(teamId), last);
  }, [teamId, messages, readAt]);

  const send = useCallback(
    async (text: string) => {
      if (!teamId || !uid) throw new Error('Чат доступен в отряде');
      if (!text.trim()) return;
      // Don't wait for the server: offline, Firestore keeps the write queued (shown as
      // pending) and sends it when the connection returns.
      sendMessage(teamId, uid, callsign || 'Боец', text).catch(() => {});
    },
    [teamId, uid, callsign]
  );

  const value = useMemo(() => ({ messages, unread, markRead, send }), [messages, unread, markRead, send]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
