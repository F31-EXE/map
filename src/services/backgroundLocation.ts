import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { AppState, PermissionsAndroid, Platform } from 'react-native';

/**
 * "Работа в фоне": location keeps coming with the screen off. On Android this runs a
 * foreground service with a permanent notification, which also keeps the app process
 * (and so the Bluetooth mesh) alive; on iOS it uses the background location mode.
 * Fixes are handed to whoever listens (useSelfPosition), so the usual path — map,
 * Firestore, mesh — stays the same.
 */
export const BACKGROUND_TASK = 'grimmap-background-location';
export const BACKGROUND_SUPPORTED = Platform.OS !== 'web';

type Listener = (loc: Location.LocationObject) => void;
const listeners = new Set<Listener>();

// Must run at startup (this module is imported from the root layout), so the OS can
// deliver fixes to the task even after restarting the app in the background.
if (BACKGROUND_SUPPORTED && !TaskManager.isTaskDefined(BACKGROUND_TASK)) {
  TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(BACKGROUND_TASK, async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    const last = data.locations[data.locations.length - 1];
    listeners.forEach((l) => l(last));
  });
}

export function onBackgroundLocation(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Asks for "always" location and starts updates. False if the user refused. */
export async function startBackgroundLocation(): Promise<boolean> {
  if (!BACKGROUND_SUPPORTED) return false;
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return false;
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== 'granted') return false;
  if (Platform.OS === 'android' && typeof Platform.Version === 'number' && Platform.Version >= 33) {
    // So the "GrimMap на связи" notification can show (Android 13+).
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => {});
  }
  // Android 12+ refuses (and crashes the app) if a foreground service starts while the
  // app is in the background — and asking for "Allow all the time" just sent the user
  // to the system settings. Wait until GrimMap is on screen again.
  await untilForeground();
  if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_TASK)) return true;
  await Location.startLocationUpdatesAsync(BACKGROUND_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 4000,
    distanceInterval: 3,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    activityType: Location.ActivityType.Fitness,
    foregroundService: {
      notificationTitle: 'GrimMap на связи',
      notificationBody: 'Позиция и связь с отрядом работают в фоне',
      notificationColor: '#8EF07A',
      killServiceOnDestroy: true,
    },
  });
  return true;
}

function untilForeground(): Promise<void> {
  const settle = () => new Promise<void>((r) => setTimeout(r, 800));
  if (AppState.currentState === 'active') return settle();
  return new Promise<void>((resolve) => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') return;
      sub.remove();
      settle().then(resolve);
    });
  });
}

export async function stopBackgroundLocation(): Promise<void> {
  if (!BACKGROUND_SUPPORTED) return;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_TASK)) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_TASK);
    }
  } catch {
    // Not running.
  }
}
