import { Alert, Platform } from 'react-native';

/** Yes/no prompt. React Native Web's Alert is a no-op, so the browser gets window.confirm. */
export function confirmAction(
  title: string,
  message: string,
  action: string,
  onConfirm: () => void,
  destructive = false
) {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Отмена', style: 'cancel' },
    { text: action, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
  ]);
}

export function confirmDestructive(title: string, message: string, action: string, onConfirm: () => void) {
  confirmAction(title, message, action, onConfirm, true);
}
