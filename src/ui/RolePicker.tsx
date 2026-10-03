import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ROLE_ORDER, ROLES, type RoleId } from '../lib/roles';

import { RoleIcon, tap } from './components';
import { C, F, R } from './theme';

/** Grid of role badges. */
export function RolePicker({
  value,
  color,
  onPick,
}: {
  value: RoleId;
  color: string;
  onPick: (r: RoleId) => void;
}) {
  return (
    <View style={styles.roles}>
      {ROLE_ORDER.map((r) => {
        const selected = r === value;
        return (
          <Pressable
            key={r}
            onPress={() => {
              tap();
              onPick(r);
            }}
            style={[styles.role, selected && { borderColor: color, backgroundColor: color + '1F' }]}
          >
            <RoleIcon role={r} size={34} color={selected ? color : C.dim} framed />
            <Text style={[styles.roleText, selected && { color: C.text }]} numberOfLines={1}>
              {ROLES[r].title}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  roles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  role: {
    flexBasis: '30%',
    flexGrow: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.elevated,
  },
  roleText: { color: C.dim, fontSize: 12, fontFamily: F.semibold },
});
