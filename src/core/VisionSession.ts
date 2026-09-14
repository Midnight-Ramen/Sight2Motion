import { YoloVisionEngine } from './VisionEngine';
import { TeachableMachineProvider } from './TeachableMachineProvider';
import { YOLO_CAPABILITIES } from './VisionCapabilities';
import type { VisionProvider, CameraFrame } from './VisionProvider';
import type { VisionProviderKind } from './types';

export class YOLOProvider extends YoloVisionEngine implements VisionProvider {
  readonly capabilities = YOLO_CAPABILITIES;
}
/** Provider selection only; CameraManager and the app retain their existing stream and loop. */
export class VisionSession implements VisionProvider {
  private provider: VisionProvider = new YOLOProvider();
  get capabilities() { return this.provider.capabilities; }
  getClasses() { return this.provider.getClasses(); }
  async select(kind: VisionProviderKind) {
    await this.provider.dispose();
    this.provider = kind === 'yolo' ? new YOLOProvider() : new TeachableMachineProvider();
  }
  load(model: string | Uint8Array) { return this.provider.load(model); }
  detect(source: CameraFrame, threshold: number) { return this.provider.detect(source, threshold); }
  dispose() { return this.provider.dispose(); }
}
