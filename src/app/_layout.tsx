import { Exo2_500Medium, Exo2_600SemiBold, Exo2_700Bold } from '@expo-google-fonts/exo-2';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Registers the background location task at startup.
import '../services/backgroundLocation';
// Applies a saved «Интернет (LTE): выкл» before anything talks to the server.
import '../state/network';
import { installErrorRecorder, recordError } from '../services/crashGuard';
import { KEYS, saveJson } from '../lib/storage';
import { OverlaysProvider } from '../state/overlays';
import { RegionsProvider } from '../state/regions';
import { SessionProvider } from '../state/session';
import { ChatProvider } from '../state/chat';
import { GameProvider } from '../state/game';
import { SideProvider } from '../state/side';
import { C, F } from '../ui/theme';
import { NightFilter } from '../ui/NightFilter';
import { setupPwa } from '../services/pwa';
import { installWebAlert } from '../ui/webAlert';

installErrorRecorder();
installWebAlert();
setupPwa();

// Keep the logo up until the fonts are in, so the app doesn't flash blank.
SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ fade: true, duration: 300 });

export default function RootLayout() {
  // Android draws edge to edge: in landscape the system navigation bar sits over a side
  // of the window, so stack screens keep their content clear of it.
  const insets = useSafeAreaInsets();
  const [fontsLoaded, fontError] = useFonts({
    Exo2_500Medium,
    Exo2_600SemiBold,
    Exo2_700Bold,
    JetBrainsMono_500Medium,
  });

  const fontsDone = fontsLoaded || Boolean(fontError);
  useEffect(() => {
    if (fontsDone) SplashScreen.hideAsync().catch(() => {});
  }, [fontsDone]);

  // Fall back to system fonts rather than hang if loading fails.
  if (!fontsDone) return <View style={{ flex: 1, backgroundColor: C.bg }} />;

  return (
    <SessionProvider>
      <SideProvider>
        <GameProvider>
          <ChatProvider>
            <OverlaysProvider>
              <RegionsProvider>
              <StatusBar style="light" />
              <Stack
                screenOptions={{
                  headerStyle: { backgroundColor: C.bg },
                  headerShadowVisible: false,
                  headerTintColor: C.text,
                  headerTitleStyle: { fontFamily: F.mono, fontSize: 15 },
                  headerBackButtonDisplayMode: 'minimal',
                  contentStyle: { backgroundColor: C.bg, paddingLeft: insets.left, paddingRight: insets.right },
                }}
              >
                <Stack.Screen
                  name="(tabs)"
                  options={{ headerShown: false, title: 'Карта', contentStyle: { backgroundColor: C.bg } }}
                />
                <Stack.Screen name="maps" options={{ title: 'Карты полигона' }} />
                <Stack.Screen name="regions" options={{ title: 'Схемы регионов' }} />
                <Stack.Screen name="side" options={{ title: 'Командование стороной' }} />
                <Stack.Screen name="side-chat" options={{ title: 'Чат стороны' }} />
                <Stack.Screen name="links" options={{ title: 'Связь отряда' }} />
                <Stack.Screen name="trackers" options={{ title: 'Трекеры' }} />
                <Stack.Screen name="game" options={{ title: 'Большая игра' }} />
                <Stack.Screen name="scan" options={{ title: 'Сканировать QR', presentation: 'modal' }} />
                <Stack.Screen name="join" options={{ title: 'Приглашение' }} />
                <Stack.Screen name="polygon" options={{ title: 'Игра из календаря' }} />
                <Stack.Screen name="replay" options={{ title: 'Записи игр' }} />
                <Stack.Screen name="briefing" options={{ title: 'Брифинг' }} />
                <Stack.Screen name="share-marks" options={{ title: 'Метки по QR' }} />
              </Stack>
              <NightFilter />
              </RegionsProvider>
            </OverlaysProvider>
          </ChatProvider>
        </GameProvider>
      </SideProvider>
    </SessionProvider>
  );
}

/**
 * Shown instead of the app when a screen crashes while rendering: the error text, a
 * retry, and a way out if the crash comes from Bluetooth or background mode.
 */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  useEffect(() => {
    recordError(error, false);
    SplashScreen.hideAsync().catch(() => {});
  }, [error]);
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, padding: 24, paddingTop: 80, gap: 16 }}>
      <Text style={{ color: C.text, fontSize: 22, fontWeight: '700' }}>Что-то сломалось</Text>
      <Text style={{ color: C.dim, fontSize: 15 }} selectable>
        {error.message}
      </Text>
      <Pressable
        onPress={() => retry()}
        style={{ backgroundColor: C.accent, padding: 16, borderRadius: 8, alignItems: 'center' }}
      >
        <Text style={{ color: C.accentInk, fontSize: 16, fontWeight: '700' }}>Попробовать снова</Text>
      </Pressable>
      <Pressable
        onPress={async () => {
          await saveJson(KEYS.mesh, false);
          await saveJson(KEYS.radioOff, true);
          await saveJson(KEYS.background, false);
          await retry();
        }}
        style={{ borderColor: C.lineStrong, borderWidth: 1, padding: 16, borderRadius: 8, alignItems: 'center' }}
      >
        <Text style={{ color: C.text, fontSize: 15 }}>Отключить рацию и фон, затем снова</Text>
      </Pressable>
    </View>
  );
}
