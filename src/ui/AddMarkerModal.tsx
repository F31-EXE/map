import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { formatCoords } from '../lib/geo';
import { MARKER_KINDS, MARKER_KIND_ORDER } from '../lib/markerKinds';
import type { LatLng, MarkerKind } from '../lib/types';
import { Button } from './components';
import { C } from './theme';

export function AddMarkerModal({
  at,
  shared,
  onCancel,
  onSave,
}: {
  at: LatLng | null;
  /** True when the marker will be visible to the whole team. */
  shared: boolean;
  onCancel: () => void;
  onSave: (kind: MarkerKind, label: string) => Promise<void>;
}) {
  const [kind, setKind] = useState<MarkerKind>('enemy');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (at) setLabel('');
  }, [at]);

  const save = async () => {
    setBusy(true);
    try {
      await onSave(kind, label);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={!!at} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Новая метка</Text>
          {at && (
            <Text style={styles.sub}>
              {formatCoords(at)} · {shared ? 'видна команде' : 'только на этом устройстве'}
            </Text>
          )}
          <View style={styles.grid}>
            {MARKER_KIND_ORDER.map((k) => {
              const def = MARKER_KINDS[k];
              const selected = k === kind;
              return (
                <Pressable
                  key={k}
                  onPress={() => setKind(k)}
                  style={[styles.kind, selected && { borderColor: def.color, backgroundColor: '#2a332e' }]}
                >
                  <View style={[styles.symbol, { backgroundColor: def.color }]}>
                    <Text style={styles.symbolText}>{def.symbol}</Text>
                  </View>
                  <Text style={styles.kindText} numberOfLines={2}>
                    {def.title}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder="Подпись (необязательно)"
            placeholderTextColor={C.muted}
            maxLength={40}
            style={styles.input}
            returnKeyType="done"
            onSubmitEditing={save}
          />
          <View style={styles.row}>
            <Button title="Отмена" kind="secondary" onPress={onCancel} style={{ flex: 1 }} />
            <Button title="Поставить" onPress={save} busy={busy} style={{ flex: 1 }} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: C.bg,
    padding: 16,
    paddingBottom: 32,
    gap: 12,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1,
    borderColor: C.border,
  },
  title: { color: C.text, fontSize: 18, fontWeight: '700' },
  sub: { color: C.muted, fontSize: 13 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kind: {
    width: '23%',
    flexGrow: 1,
    alignItems: 'center',
    gap: 4,
    padding: 8,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: C.card,
  },
  symbol: {
    width: 32,
    height: 32,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  symbolText: { fontSize: 16, color: '#000' },
  kindText: { color: C.text, fontSize: 11, textAlign: 'center' },
  input: {
    backgroundColor: C.card,
    color: C.text,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 46,
    borderWidth: 1,
    borderColor: C.border,
    fontSize: 16,
  },
  row: { flexDirection: 'row', gap: 10 },
});
