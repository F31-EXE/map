import { Tabs } from 'expo-router/js-tabs';
import { useWindowDimensions } from 'react-native';

import { useChat } from '../../state/chat';
import { useSession } from '../../state/session';
import { TabBar, type TabMeta } from '../../ui/TabBar';
import { C, F } from '../../ui/theme';

export default function TabsLayout() {
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const chat = useChat();
  const session = useSession();
  const meta: Record<string, TabMeta> = {
    index: { icon: 'map-outline', label: 'Карта' },
    chat: { icon: 'forum-outline', label: 'Чат', badge: session.teamId ? chat.unread : 0 },
    team: { icon: 'account-group-outline', label: 'Отряд' },
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
      <Tabs.Screen name="chat" options={{ title: 'Чат отряда' }} />
      <Tabs.Screen name="team" options={{ title: 'Отряд' }} />
      <Tabs.Screen name="settings" options={{ title: 'Настройки' }} />
    </Tabs>
  );
}
