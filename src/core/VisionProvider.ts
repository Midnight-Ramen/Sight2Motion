import type { VisionResult } from './types';
import type { VisionCapabilities } from './VisionCapabilities';
export type CameraFrame = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;
export interface VisionProvider {
  readonly capabilities: VisionCapabilities;
  getClasses(): readonly string[];
  load(model: string | Uint8Array): Promise<string>;
  detect(source: CameraFrame, threshold: number): Promise<VisionResult[]>;
  dispose(): Promise<void>;
}
