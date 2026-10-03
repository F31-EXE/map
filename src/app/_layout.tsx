import { Exo2_500Medium, Exo2_600SemiBold, Exo2_700Bold } from '@expo-google-fonts/exo-2';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';

import { OverlaysProvider } from '../state/overlays';
import { SessionProvider } from '../state/session';
import { C, F } from '../ui/theme';

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Exo2_500Medium,
    Exo2_600SemiBold,
    Exo2_700Bold,
    JetBrainsMono_500Medium,
  });

  // Fall back to system fonts rather than hang if loading fails.
  if (!fontsLoaded && !fontError) return <View style={{ flex: 1, backgroundColor: C.bg }} />;

  return (
    <SessionProvider>
      <OverlaysProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: C.bg },
            headerShadowVisible: false,
            headerTintColor: C.text,
            headerTitleStyle: { fontFamily: F.bold, fontSize: 18 },
            headerBackButtonDisplayMode: 'minimal',
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
