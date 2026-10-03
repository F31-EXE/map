import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { formatCoords } from '../lib/geo';
import { MARKER_KINDS, MARKER_KIND_ORDER } from '../lib/markerKinds';
import type { LatLng, MarkerKind } from '../lib/types';
import { Button, Icon, Sheet, tap } from './components';
import { C, F, R } from './theme';

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

  const active = MARKER_KINDS[kind];

  return (
    <Sheet visible={!!at} onClose={onCancel}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Новая метка</Text>
          {at && <Text style={styles.coords}>{formatCoords(at)}</Text>}
        </View>
        <View style={[styles.scope, shared && styles.scopeShared]}>
          <Icon name={shared ? 'account-group' : 'cellphone'} size={14} color={shared ? C.accent : C.dim} />
          <Text style={[styles.scopeText, shared && { color: C.accent }]}>{shared ? 'Команде' : 'Только мне'}</Text>
        </View>
      </View>

      <View style={styles.grid}>
        {[...MARKER_KIND_ORDER, null].map((k) => {
          // Trailing spacer keeps the last row's tiles the same width as the first.
          if (!k) return <View key="spacer" style={[styles.kind, styles.spacer]} />;
          const def = MARKER_KINDS[k];
          const selected = k === kind;
          return (
            <Pressable
              key={k}
              onPress={() => {
                tap();
                setKind(k);
              }}
              style={[
                styles.kind,
                selected && { borderColor: def.color, backgroundColor: def.color + '1F' },
              ]}
            >
              <View style={[styles.kindIcon, { borderColor: def.color, backgroundColor: selected ? def.color : 'transparent' }]}>
                <Icon name={def.icon} size={20} color={selected ? C.accentInk : def.color} />
              </View>
              <Text style={[styles.kindText, selected && { color: C.text }]} numberOfLines={1}>
                {def.title}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <TextInput
        value={label}
        onChangeText={setLabel}
        placeholder="Подпись: «пулемёт», «вход в здание»…"
        placeholderTextColor={C.faint}
        maxLength={40}
        style={styles.input}
        returnKeyType="done"
        onSubmitEditing={save}
        selectionColor={C.accent}
      />
      <View style={styles.row}>
        <Button title="Отмена" kind="secondary" onPress={onCancel} style={{ flex: 1 }} />
        <Button title={`Поставить`} icon={active.icon} onPress={save} busy={busy} style={{ flex: 1.4 }} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { color: C.text, fontSize: 22, fontFamily: F.bold },
  coords: { color: C.dim, fontSize: 12, fontFamily: F.mono, marginTop: 2 },
  scope: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: C.line,
  },
  scopeShared: { borderColor: C.accent + '55', backgroundColor: C.accentSoft },
  scopeText: { color: C.dim, fontSize: 12, fontFamily: F.semibold },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kind: {
    flexBasis: '22%',
    flexGrow: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: R.md,
    borderWidth: 1.5,
    borderColor: C.line,
    backgroundColor: C.elevated,
  },
  kindIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spacer: { opacity: 0, borderWidth: 0 },
  kindText: { color: C.dim, fontSize: 12, fontFamily: F.semibold },
  input: {
    backgroundColor: C.elevated,
    color: C.text,
    borderRadius: R.md,
    paddingHorizontal: 14,
    height: 52,
    borderWidth: 1,
    borderColor: C.line,
    fontSize: 16,
    fontFamily: F.regular,
  },
  row: { flexDirection: 'row', gap: 10 },
});
