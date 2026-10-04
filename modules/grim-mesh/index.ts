import { NativeModule, requireOptionalNativeModule } from 'expo';

export type PeerEvent = {
  id: string;
  name: string | null;
  state: 'found' | 'lost' | 'connected' | 'disconnected' | 'failed';
};
export type MessageEvent = { from: string; data: string };
export type ErrorEvent = { where: string; message: string };

type Events = {
  onPeer: (e: PeerEvent) => void;
  onMessage: (e: MessageEvent) => void;
  onError: (e: ErrorEvent) => void;
};

declare class GrimMeshModule extends NativeModule<Events> {
  start(serviceId: string, name: string, acceptPrefix: string): Promise<void>;
  stop(): Promise<void>;
  connect(endpointId: string): Promise<void>;
  send(to: string[], data: string): Promise<void>;
  connectedPeers(): string[];
}

/** Android only; null on iOS, web and in Expo Go. */
export const GrimMesh = requireOptionalNativeModule<GrimMeshModule>('GrimMesh');
