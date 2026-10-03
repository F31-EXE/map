import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSelfPosition } from '../hooks/useSelfPosition';
import { describeVector, formatCoords, timeAgo } from '../lib/geo';
import { MARKER_KINDS } from '../lib/markerKinds';
import { KEYS, loadJson, saveJson } from '../lib/storage';
import type { LatLng, MarkerKind } from '../lib/types';
import { BASE_LAYERS, TacticalMap, type BaseLayerId, type TacticalMapHandle } from '../map/TacticalMap';
import { useOverlays } from '../state/overlays';
import { useSession } from '../state/session';
import { AddMarkerModal } from '../ui/AddMarkerModal';
import { Fab } from '../ui/components';
import { C } from '../ui/theme';

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const session = useSession();
  const { overlays, focusRequest, requestFocus } = useOverlays();
  const { position, status } = useSelfPosition();
  const mapRef = useRef<TacticalMapHandle>(null);

  const [baseLayer, setBaseLayer] = useState<BaseLayerId>('yandex-sat');
  const [layerPicker, setLayerPicker] = useState(false);
  const [follow, setFollow] = useState(false);
  const [center, setCenter] = useState<LatLng | null>(null);
  const [addAt, setAddAt] = useState<LatLng | null>(null);
  const centeredOnce = useRef(false);

  useEffect(() => {
    loadJson<BaseLayerId>(KEYS.baseLayer, 'yandex-sat').then(setBaseLayer);
  }, []);

  const chooseLayer = (id: BaseLayerId) => {
    setBaseLayer(id);
    setLayerPicker(false);
    saveJson(KEYS.baseLayer, id);
  };

  // Publish own position to the team (throttled inside the session).
  const { reportPosition } = session;
  useEffect(() => {
    if (position) reportPosition(position);
  }, [position, reportPosition]);

  // Jump to the first GPS fix once, unless an imported map is being focused.
  useEffect(() => {
    if (position && !centeredOnce.current && !focusRequest) {
      centeredOnce.current = true;
      mapRef.current?.setView(position, 16);
    }
  }, [position, focusRequest]);

  // An overlay was just imported/selected on the maps screen; TacticalMap zooms to it.
  const onFocusHandled = useCallback(() => {
    centeredOnce.current = true;
    requestFocus(null);
  }, [requestFocus]);

  const onMarkerPress = useCallback(
    (id: string) => {
      const m = session.markers.find((x) => x.id === id);
      if (!m) return;
      const kind = MARKER_KINDS[m.kind] ?? MARKER_KINDS.note;
      const lines = [
        m.label || null,
        formatCoords(m),
        describeVector(position, m),
        `${m.createdByName} · ${timeAgo(m.createdAt)}`,
      ].filter(Boolean);
      Alert.alert(kind.title, lines.join('\n'), [
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: () => session.deleteMarker(id).catch((e: Error) => Alert.alert('Ошибка', e.message)),
        },
        { text: 'Закрыть', style: 'cancel' },
      ]);
    },
    [session, position]
  );

  const onMemberPress = useCallback(
    (id: string) => {
      const m = session.members.find((x) => x.id === id);
      if (!m || m.lat == null || m.lng == null) return;
      const p = { lat: m.lat, lng: m.lng };
      const lines = [
        formatCoords(p),
        describeVector(position, p),
        m.updatedAt ? `обновлено ${timeAgo(m.updatedAt)}` : null,
      ].filter(Boolean);
      Alert.alert(m.callsign, lines.join('\n'));
    },
    [session.members, position]
  );

  const saveMarker = async (kind: MarkerKind, label: string) => {
    if (!addAt) return;
    try {
      await session.addMarker({ kind, label, lat: addAt.lat, lng: addAt.lng });
      setAddAt(null);
    } catch (e) {
      Alert.alert('Не удалось поставить метку', (e as Error).message);
    }
  };

  const onOverlayError = useCallback((_id: string, message: string) => {
    Alert.alert('Ошибка карты', message);
  }, []);

  const inTeam = Boolean(session.teamId && session.uid);
  const online = session.members.filter(
    (m) => m.id !== session.uid && m.updatedAt && Date.now() - m.updatedAt < 2 * 60_000
  ).length;

  return (
    <View style={styles.root}>
      <TacticalMap
        ref={mapRef}
        baseLayer={baseLayer}
        self={position}
        follow={follow}
        members={session.members}
        selfId={session.uid}
        markers={session.markers}
        overlays={overlays}
        focusOverlay={focusRequest}
        onFocusHandled={onFocusHandled}
        onLongPress={setAddAt}
        onMarkerPress={onMarkerPress}
        onMemberPress={onMemberPress}
        onViewChanged={setCenter}
        onFollowChanged={setFollow}
        onOverlayError={onOverlayError}
      />

      {/* Crosshair: "+" places a marker exactly here. */}
      <View pointerEvents="none" style={styles.crosshair}>
        <Text style={styles.crosshairText}>+</Text>
      </View>

      <View style={[styles.topBar, { top: insets.top + 8 }]}>
        <Pressable style={styles.teamChip} onPress={() => router.push('/team')}>
          <View style={[styles.dot, { backgroundColor: inTeam ? C.accent : C.muted }]} />
          <Text style={styles.teamText} numberOfLines={1}>
            {inTeam
              ? `${session.team?.name ?? '…'} · ${online} в сети`
              : session.callsign
                ? `${session.callsign} · без команды`
                : 'Укажите позывной'}
          </Text>
        </Pressable>
        <Fab label="▦" size={44} onPress={() => setLayerPicker(true)} />
        <Fab label="⧉" size={44} onPress={() => router.push('/maps')} />
      </View>

      {session.teamError && inTeam && (
        <View style={[styles.banner, { top: insets.top + 60 }]}>
          <Text style={styles.bannerText}>{session.teamError}</Text>
        </View>
      )}
      {status === 'denied' && (
        <View style={[styles.banner, { top: insets.top + 60 }]}>
          <Text style={styles.bannerText}>Нет доступа к геолокации — разрешите его в настройках телефона</Text>
        </View>
      )}

      <View style={[styles.rightColumn, { bottom: insets.bottom + 70 }]}>
        <Fab label="✚" onPress={() => center && setAddAt(center)} />
        <Fab
          label="◎"
          active={follow}
          onPress={() => {
            if (!position) {
              Alert.alert('Нет GPS', 'Координаты ещё не определены');
              return;
            }
            if (follow) setFollow(false);
            else {
              mapRef.current?.centerOnSelf();
              setFollow(true);
            }
          }}
        />
      </View>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 8 }]}>
        <Text style={styles.coords}>
          {center ? formatCoords(center) : '—'}
          {center && position ? `   ${describeVector(position, center)}` : ''}
        </Text>
        <Text style={styles.gps}>
          {position?.accuracy != null ? `GPS ±${Math.round(position.accuracy)} м` : 'GPS …'}
        </Text>
      </View>

      <AddMarkerModal at={addAt} shared={inTeam} onCancel={() => setAddAt(null)} onSave={saveMarker} />

      <Modal visible={layerPicker} transparent animationType="fade" onRequestClose={() => setLayerPicker(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setLayerPicker(false)}>
          <View style={styles.layerList}>
            <Text style={styles.layerTitle}>Подложка</Text>
            {BASE_LAYERS.map((l) => (
              <Pressable key={l.id} style={styles.layerItem} onPress={() => chooseLayer(l.id)}>
                <Text style={[styles.layerText, l.id === baseLayer && { color: C.accent }]}>
                  {l.id === baseLayer ? '● ' : '○ '}
                  {l.title}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  crosshair: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crosshairText: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '300',
    textShadowColor: '#000',
    textShadowRadius: 3,
  },
  topBar: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', gap: 8, alignItems: 'center' },
  teamChip: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: C.border,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    gap: 8,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  teamText: { color: C.text, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  banner: {
    position: 'absolute',
    left: 12,
    right: 12,
    backgroundColor: 'rgba(183, 28, 28, 0.9)',
    borderRadius: 10,
    padding: 10,
  },
  bannerText: { color: '#fff', fontSize: 13 },
  rightColumn: { position: 'absolute', right: 12, gap: 12 },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: C.panel,
    paddingTop: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  coords: { color: C.text, fontSize: 12, fontVariant: ['tabular-nums'], flexShrink: 1 },
  gps: { color: C.muted, fontSize: 12 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 32 },
  layerList: { backgroundColor: C.bg, borderRadius: 14, padding: 8, borderWidth: 1, borderColor: C.border },
  layerTitle: { color: C.muted, fontSize: 13, fontWeight: '600', padding: 10, textTransform: 'uppercase' },
  layerItem: { paddingVertical: 12, paddingHorizontal: 10 },
  layerText: { color: C.text, fontSize: 16 },
});
