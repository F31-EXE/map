import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { loadJson, saveJson } from '../lib/storage';
import { newMessageId, relayMessage, sendMessage, subscribeMessages, type ChatMessage } from '../services/chat';
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
  const { teamId, uid, callsign, mesh } = useSession();
  const [serverMessages, setMessages] = useState<ChatMessage[]>([]);

  // Messages heard over Bluetooth that the server doesn't have (yet).
  const messages = useMemo(() => {
    if (!mesh.chats.length) return serverMessages;
    const known = new Set(serverMessages.map((m) => m.id));
    const extra = mesh.chats
      .filter((c) => !known.has(c.id))
      .map((c) => ({ id: c.id, uid: c.uid, callsign: c.callsign, text: c.text, createdAt: c.t, viaMesh: true }));
    if (!extra.length) return serverMessages;
    return [...serverMessages, ...extra].sort((a, b) => a.createdAt - b.createdAt);
  }, [serverMessages, mesh.chats]);

  // Gateway: once this phone has internet, upload what it heard for those who don't.
  // Waits a little first, so the sender's own upload usually wins.
  const relayed = useRef(new Set<string>());
  useEffect(() => {
    if (!teamId || !uid) return;
    const pendingRelay = messages.filter((m) => m.viaMesh && m.uid !== uid && !relayed.current.has(m.id));
    if (!pendingRelay.length) return;
    const t = setTimeout(() => {
      for (const m of pendingRelay) {
        relayed.current.add(m.id);
        relayMessage(teamId, uid, { id: m.id, uid: m.uid, callsign: m.callsign, text: m.text, t: m.createdAt }).catch(() => {});
      }
    }, 20_000);
    return () => clearTimeout(t);
  }, [messages, teamId, uid]);
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
      const id = newMessageId(uid);
      const name = callsign || 'Боец';
      // Nearby phones get it over Bluetooth right away, with the same id.
      mesh.sendChat({ id, uid, callsign: name.slice(0, 24), text: text.trim().slice(0, 500) });
      // Don't wait for the server: offline, Firestore keeps the write queued (shown as
      // pending) and sends it when the connection returns.
      sendMessage(teamId, uid, name, text, id).catch(() => {});
    },
    [teamId, uid, callsign, mesh]
  );

  const value = useMemo(() => ({ messages, unread, markRead, send }), [messages, unread, markRead, send]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
