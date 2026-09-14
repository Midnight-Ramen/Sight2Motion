import type { ClassificationResult } from './types';
import type { CameraFrame, VisionProvider } from './VisionProvider';
import { TM_CAPABILITIES } from './VisionCapabilities';
import { normalizeTeachableMachineUrl } from './TeachableMachineUrl';

export interface ImageClassifier {
  getClassLabels(): string[];
  predict(source: CameraFrame): Promise<{ className: string; probability: number }[]>;
  dispose(): void;
}
export type ImageModelLoader = (modelUrl: string, metadataUrl: string) => Promise<ImageClassifier>;
const loadImageModel: ImageModelLoader = async (modelUrl, metadataUrl) => {
  const tf = await import('@tensorflow/tfjs');
  await tf.ready();
  const tm = await import('@teachablemachine/image');
  const loaded = await tm.load(modelUrl, metadataUrl);
  return {
    getClassLabels: () => loaded.getClassLabels(),
    predict: source => loaded.predict(source),
    // The shared-model loader populates model, not the training-only truncatedModel.
    dispose: () => { loaded.model.dispose(); },
  };
};

export class TeachableMachineProvider implements VisionProvider {
  readonly capabilities = TM_CAPABILITIES;
  private model: ImageClassifier | null = null;
  private labels: string[] = [];
  constructor(private loader: ImageModelLoader = loadImageModel) {}
  getClasses() { return this.labels; }
  async load(input: string | Uint8Array) {
    await this.dispose();
    if (typeof input !== 'string') throw new Error('Paste a Teachable Machine model link.');
    const url = normalizeTeachableMachineUrl(input);
    const model = await this.loader(`${url}model.json`, `${url}metadata.json`);
    const labels = model.getClassLabels();
    if (!labels.length || labels.length > 80 || labels.some(label => typeof label !== 'string' || !label.trim() || label.length > 100) ||
      new Set(labels).size !== labels.length) {
      model.dispose();
      throw new Error('This model needs valid, unique image class names.');
    }
    this.model = model;
    this.labels = [...labels];
    return 'Image classification · local inference';
  }
  async detect(source: CameraFrame): Promise<ClassificationResult[]> {
    if (!this.model) throw new Error('Load the image model first.');
    const predictions = await this.model.predict(source);
    return predictions.filter(p => this.labels.includes(p.className) && Number.isFinite(p.probability) && p.probability >= 0 && p.probability <= 1)
      .map(p => ({ className: p.className, confidence: p.probability }))
      .sort((a, b) => b.confidence - a.confidence);
  }
  async dispose() {
    this.model?.dispose();
    this.model = null;
    this.labels = [];
  }
}
