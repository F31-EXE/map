import { Alert, Platform, type AlertButton } from 'react-native';

/**
 * React Native Web's Alert.alert does nothing, so in the browser errors went unseen and
 * confirmations (leave the squad, delete…) never ran. Map it onto the browser's own
 * dialogs: one confirm per action button, in order, until one is accepted.
 */
export function installWebAlert() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  Alert.alert = (title: string, message?: string, buttons?: AlertButton[]) => {
    const text = message ? `${title}\n\n${message}` : title;
    const actions = (buttons ?? []).filter((b) => b.style !== 'cancel');
    if (actions.length <= 1 && (buttons?.length ?? 0) <= 1) {
      window.alert(text);
      actions[0]?.onPress?.();
      return;
    }
    for (const b of actions) {
      const ask = actions.length > 1 ? `${text}\n\n${b.text}?` : text;
      if (window.confirm(ask)) {
        b.onPress?.();
        return;
      }
    }
    buttons?.find((b) => b.style === 'cancel')?.onPress?.();
  };
}
