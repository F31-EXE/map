import { Tabs } from 'expo-router/js-tabs';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useChat } from '../../state/chat';
import { useSession } from '../../state/session';
import { TabBar, type TabMeta } from '../../ui/TabBar';
import { C, F } from '../../ui/theme';

export default function TabsLayout() {
  const { width, height } = useWindowDimensions();
  // Edge to edge: in landscape the Android navigation bar covers the right edge (the
  // tab bar takes care of the left one). The map screen places its own panels.
  const insets = useSafeAreaInsets();
  const side = { paddingRight: insets.right };
  const landscape = width > height;
  const chat = useChat();
  const session = useSession();
  // A briefing this fighter hasn't confirmed yet.
  const brief = session.team?.briefing;
  const me = session.members.find((m) => m.id === session.uid);
  const briefingUnread = Boolean(brief && brief.by !== session.uid && me && me.briefRead !== brief.at);
  const meta: Record<string, TabMeta> = {
    index: { icon: 'map-outline', label: 'Карта' },
    chat: { icon: 'forum-outline', label: 'Чат', badge: session.teamId ? chat.unread : 0 },
    team: { icon: 'account-group-outline', label: 'Отряд', badge: briefingUnread ? 1 : 0 },
    settings: { icon: 'cog-outline', label: 'Настр.' },
  };

  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} meta={meta} vertical={landscape} />}
      screenOptions={{
        tabBarPosition: landscape ? 'left' : 'bottom',
        headerStyle: { backgroundColor: C.bg, borderBottomWidth: 1, borderBottomColor: C.line },
        headerShadowVisible: false,
        headerTintColor: C.text,
        headerTitleStyle: { fontFamily: F.mono, fontSize: 15, letterSpacing: 1.5, textTransform: 'uppercase' },
        sceneStyle: { backgroundColor: C.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ headerShown: false, title: 'Карта' }} />
      <Tabs.Screen name="chat" options={{ title: 'Чат отряда', sceneStyle: { backgroundColor: C.bg, ...side } }} />
      <Tabs.Screen name="team" options={{ title: 'Отряд', sceneStyle: { backgroundColor: C.bg, ...side } }} />
      <Tabs.Screen name="settings" options={{ title: 'Настройки', sceneStyle: { backgroundColor: C.bg, ...side } }} />
    </Tabs>
  );
}
