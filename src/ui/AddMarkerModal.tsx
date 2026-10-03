import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { formatCoords } from '../lib/geo';
import { isOrder, MARKER_KINDS, MARKER_KIND_ORDER, ORDER_KINDS } from '../lib/markerKinds';
import type { LatLng, MarkerKind } from '../lib/types';
import type { MarkerScope } from '../state/session';
import { Button, Eyebrow, Icon, Sheet, tap } from './components';
import { C, F, R } from './theme';

export function AddMarkerModal({
  at,
  inTeam,
  canCommand,
  onCancel,
  onSave,
}: {
  at: LatLng | null;
  inTeam: boolean;
  /** Shows the orders row (move / attack / defend). */
  canCommand: boolean;
  onCancel: () => void;
  onSave: (kind: MarkerKind, label: string, scope: MarkerScope) => Promise<void>;
}) {
  const [kind, setKind] = useState<MarkerKind>('enemy');
  const [label, setLabel] = useState('');
  const [scope, setScope] = useState<MarkerScope>('team');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (at) setLabel('');
  }, [at]);

  const order = isOrder(kind);
  // Orders always go to the team; without a team everything is personal.
  const effectiveScope: MarkerScope = !inTeam ? 'personal' : order ? 'team' : scope;

  const save = async () => {
    setBusy(true);
    try {
      await onSave(kind, label, effectiveScope);
    } finally {
      setBusy(false);
    }
  };

  const pick = (k: MarkerKind) => {
    tap();
    setKind(k);
  };

  const active = MARKER_KINDS[kind];

  return (
    <Sheet visible={!!at} onClose={onCancel}>
      <View>
        <Text style={styles.title}>{order ? 'Приказ' : 'Новая метка'}</Text>
        {at && <Text style={styles.coords}>{formatCoords(at)}</Text>}
      </View>

      {canCommand && (
        <View style={{ gap: 8 }}>
          <Eyebrow>Приказ бойцам · вибро и звук</Eyebrow>
          <View style={styles.orders}>
            {ORDER_KINDS.map((k) => {
              const def = MARKER_KINDS[k];
              const selected = k === kind;
              return (
                <Pressable
                  key={k}
                  onPress={() => pick(k)}
                  style={[styles.order, selected && { borderColor: def.color, backgroundColor: def.color + '1F' }]}
                >
                  <View
                    style={[
                      styles.orderIcon,
                      { borderColor: def.color, backgroundColor: selected ? def.color : 'transparent' },
                    ]}
                  >
                    <Icon name={def.icon} size={18} color={selected ? C.accentInk : def.color} />
                  </View>
                  <Text style={[styles.orderText, selected && { color: C.text }]} numberOfLines={2}>
                    {def.title}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      <View style={{ gap: 8 }}>
        {canCommand && <Eyebrow>Метка</Eyebrow>}
        <View style={styles.grid}>
          {[...MARKER_KIND_ORDER, null].map((k) => {
            // Trailing spacer keeps the last row's tiles the same width as the first.
            if (!k) return <View key="spacer" style={[styles.kind, styles.spacer]} />;
            const def = MARKER_KINDS[k];
            const selected = k === kind;
            return (
              <Pressable
                key={k}
                onPress={() => pick(k)}
                style={[styles.kind, selected && { borderColor: def.color, backgroundColor: def.color + '1F' }]}
              >
                <View
                  style={[
                    styles.kindIcon,
                    { borderColor: def.color, backgroundColor: selected ? def.color : 'transparent' },
                  ]}
                >
                  <Icon name={def.icon} size={20} color={selected ? C.accentInk : def.color} />
                </View>
                <Text style={[styles.kindText, selected && { color: C.text }]} numberOfLines={1}>
                  {def.title}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {inTeam && (
        <View style={[styles.segment, order && { opacity: 0.45 }]}>
          {(['team', 'personal'] as const).map((sc) => {
            const selected = effectiveScope === sc;
            return (
              <Pressable
                key={sc}
                disabled={order}
                onPress={() => {
                  tap();
                  setScope(sc);
                }}
                style={[styles.segmentItem, selected && styles.segmentActive]}
              >
                <Icon
                  name={sc === 'team' ? 'account-group' : 'eye-off-outline'}
                  size={16}
                  color={selected ? C.accentInk : C.dim}
                />
                <Text style={[styles.segmentText, selected && { color: C.accentInk }]}>
                  {sc === 'team' ? 'Бойцам' : 'Только мне'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <TextInput
        value={label}
        onChangeText={setLabel}
        placeholder={order ? 'Пояснение: «зайти с фланга»…' : 'Подпись: «пулемёт», «вход в здание»…'}
        placeholderTextColor={C.faint}
        maxLength={40}
        style={styles.input}
        returnKeyType="done"
        onSubmitEditing={save}
        selectionColor={C.accent}
      />
      <View style={styles.row}>
        <Button title="Отмена" kind="secondary" onPress={onCancel} style={{ flex: 1 }} />
        <Button
          title={order ? 'Отдать приказ' : 'Поставить'}
          icon={active.icon}
          onPress={save}
          busy={busy}
          style={{ flex: 1.4 }}
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  title: { color: C.text, fontSize: 22, fontFamily: F.bold },
  coords: { color: C.dim, fontSize: 12, fontFamily: F.mono, marginTop: 2 },
  orders: { flexDirection: 'row', gap: 8 },
  order: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: R.md,
    borderWidth: 1.5,
    borderColor: C.line,
    backgroundColor: C.elevated,
  },
  orderIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '45deg' }],
  },
  orderText: { color: C.dim, fontSize: 12, fontFamily: F.semibold, flex: 1 },
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
  spacer: { opacity: 0, borderWidth: 0 },
  kindIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kindText: { color: C.dim, fontSize: 12, fontFamily: F.semibold },
  segment: { flexDirection: 'row', backgroundColor: C.elevated, borderRadius: R.md, padding: 4 },
  segmentItem: {
    flex: 1,
    height: 40,
    borderRadius: R.sm,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  segmentActive: { backgroundColor: C.accent },
  segmentText: { color: C.dim, fontSize: 14, fontFamily: F.semibold },
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
