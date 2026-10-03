import { Alert, Platform } from 'react-native';

/** Destructive yes/no prompt. React Native Web's Alert is a no-op, so the browser gets window.confirm. */
export function confirmDestructive(title: string, message: string, action: string, onConfirm: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Отмена', style: 'cancel' },
    { text: action, style: 'destructive', onPress: onConfirm },
  ]);
}
