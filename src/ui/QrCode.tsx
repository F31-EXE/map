import qrcode from 'qrcode-generator';
import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

/** Dark-on-light QR (scanners expect that contrast) with a quiet zone. */
export function QrCode({ value, size = 200 }: { value: string; size?: number }) {
  const { path, count } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    }
    return { path: d, count: n };
  }, [value]);

  const quiet = 2;
  const box = count + quiet * 2;
  return (
    <View style={{ width: size, height: size, borderRadius: 12, overflow: 'hidden' }}>
      <Svg width={size} height={size} viewBox={`${-quiet} ${-quiet} ${box} ${box}`}>
        <Rect x={-quiet} y={-quiet} width={box} height={box} fill="#F4F7F2" />
        <Path d={path} fill="#0B0F0C" />
      </Svg>
    </View>
  );
}
