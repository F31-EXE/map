import { useMemo, useRef, useState } from "react";
import {
  Image,
  Modal,
  PanResponder,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { clampFrame, cropRect, pxPerImage, type Frame } from "../lib/crop";
import type { CropRect, PickedPhoto } from "../services/avatar";

import { Button } from "./components";
import { NightFilter } from "./NightFilter";
import { C, F } from "./theme";

type Touch = { x: number; y: number };
const touches = (e: GestureResponderEvent): Touch[] =>
  e.nativeEvent.touches.map((t) => ({ x: t.pageX, y: t.pageY }));
const spread = (t: Touch[]) => Math.hypot(t[0].x - t[1].x, t[0].y - t[1].y);
const middle = (t: Touch[]): Touch =>
  t.length > 1 ? { x: (t[0].x + t[1].x) / 2, y: (t[0].y + t[1].y) / 2 } : t[0];

/**
 * Frames a photo for the avatar: the circle is exactly what others will see. One
 * finger moves the photo, two fingers zoom.
 */
export function AvatarCropper({
  photo,
  busy,
  onCancel,
  onDone,
}: {
  photo: PickedPhoto;
  busy?: boolean;
  onCancel: () => void;
  onDone: (rect: CropRect) => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const d = Math.round(
    Math.max(
      160,
      Math.min(width - 48, height - insets.top - insets.bottom - 240, 420),
    ),
  );
  const [frame, setFrame] = useState<Frame>({ scale: 1, x: 0, y: 0 });
  const live = useRef(frame);
  live.current = frame;
  // Where the gesture started: frame, finger midpoint and two-finger spread.
  const start = useRef<{
    f: Frame;
    m: Touch;
    s: number | null;
    n: number;
  } | null>(null);

  const responder = useMemo(() => {
    const begin = (e: GestureResponderEvent) => {
      const t = touches(e);
      if (!t.length) return;
      start.current = {
        f: live.current,
        m: middle(t),
        s: t.length > 1 ? spread(t) : null,
        n: t.length,
      };
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: begin,
      onPanResponderMove: (e) => {
        const t = touches(e);
        // A finger added or lifted: restart from here so the photo doesn't jump.
        if (!start.current || t.length !== start.current.n) return begin(e);
        const st = start.current;
        const m = middle(t);
        const zoom = st.s && t.length > 1 ? spread(t) / st.s : 1;
        // Zoom around the circle's center, then follow the fingers.
        const next = clampFrame(
          {
            scale: st.f.scale * zoom,
            x: st.f.x * zoom + (m.x - st.m.x),
            y: st.f.y * zoom + (m.y - st.m.y),
          },
          photo.width,
          photo.height,
          d,
        );
        setFrame(next);
      },
      onPanResponderRelease: () => {
        start.current = null;
      },
      onPanResponderTerminationRequest: () => false,
    });
  }, [photo.width, photo.height, d]);

  const k = pxPerImage(photo.width, photo.height, d, frame.scale);
  const w = photo.width * k;
  const h = photo.height * k;

  return (
    <Modal
      visible
      animationType="fade"
      onRequestClose={onCancel}
      supportedOrientations={["portrait", "landscape"]}
    >
      <View
        style={[
          styles.root,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 },
        ]}
      >
        <Text style={styles.title}>Аватар</Text>
        <Text style={styles.hint}>
          Что внутри круга — то и увидят другие. Двигайте фото пальцем, двумя
          пальцами — масштаб.
        </Text>
        <View style={styles.area} {...responder.panHandlers}>
          <View style={{ width: d, height: d }}>
            <Image
              source={{ uri: photo.uri }}
              style={{
                position: "absolute",
                width: w,
                height: h,
                left: d / 2 - w / 2 + frame.x,
                top: d / 2 - h / 2 + frame.y,
              }}
              resizeMode="stretch"
            />
            {/* Everything outside the circle dimmed; the circle outlined. */}
            <View
              pointerEvents="none"
              style={[
                styles.circle,
                { width: d, height: d, borderRadius: d / 2 },
              ]}
            />
          </View>
        </View>
        <View style={styles.row}>
          <Button
            title="Отмена"
            kind="secondary"
            style={{ flex: 1 }}
            onPress={onCancel}
          />
          <Button
            title="Готово"
            icon="check"
            busy={busy}
            style={{ flex: 1 }}
            onPress={() =>
              onDone(cropRect(frame, photo.width, photo.height, d))
            }
          />
        </View>
      </View>
      <NightFilter />
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
    paddingHorizontal: 24,
  },
  title: { color: C.text, fontFamily: F.bold, fontSize: 18 },
  hint: {
    color: C.dim,
    fontFamily: F.regular,
    fontSize: 14,
    textAlign: "center",
    maxWidth: 420,
  },
  // The photo shows dimmed beyond the circle (so you see what's left out), clipped to
  // this area so it never covers the title or the buttons. The whole area takes drags.
  area: {
    flex: 1,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  circle: {
    position: "absolute",
    left: 0,
    top: 0,
    borderWidth: 2,
    borderColor: "#fff",
    boxShadow: "0 0 0 2000px rgba(0, 0, 0, 0.62)",
  },
  row: {
    flexDirection: "row",
    gap: 12,
    alignSelf: "stretch",
    maxWidth: 420,
    width: "100%",
    marginHorizontal: "auto",
  },
});
