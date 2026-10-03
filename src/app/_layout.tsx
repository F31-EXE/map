import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { OverlaysProvider } from '../state/overlays';
import { SessionProvider } from '../state/session';
import { C } from '../ui/theme';

export default function RootLayout() {
  return (
    <SessionProvider>
      <OverlaysProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: C.bg },
            headerTintColor: C.text,
            contentStyle: { backgroundColor: C.bg },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false, title: 'Карта' }} />
          <Stack.Screen name="team" options={{ title: 'Команда' }} />
          <Stack.Screen name="maps" options={{ title: 'Карты полигона' }} />
        </Stack>
      </OverlaysProvider>
    </SessionProvider>
  );
}
