export type DetectionRegion = 'anywhere' | 'left' | 'center' | 'right';
export type DetectionDistance = 'any' | 'far' | 'near';
export interface Detection {
  className: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  region?: Exclude<DetectionRegion, 'anywhere'>;
  areaRatio?: number;
}
export interface ClassificationResult {
  className: string;
  confidence: number;
  region?: never;
  areaRatio?: never;
}
export type VisionResult = Detection | ClassificationResult;
export const hasBoundingBox = (result: VisionResult): result is Detection => 'x' in result;
export type VisionProviderKind = 'yolo' | 'teachable-machine';
export type ActionKind = 'beak' | 'tail' | 'tailLightSequence' | 'move' | 'sound' | 'wait' | 'stop' | 'singleLed' | 'triLed' | 'positionServo' | 'rotationServo';
export type RobotType = 'finch' | 'hummingbird';
export type MotionMode = 'timed' | 'continuous';
export interface Action {
  id: string;
  kind: ActionKind;
  enabled: boolean;
  mode?: MotionMode;
  port?: number;
  brightness?: number;
  angle?: number;
  color: string;
  tailLights?: number[];
  steps?: { light: number; color: string }[];
  stepDurationMs?: number;
  repeatCount?: number;
  clearPrevious?: boolean;
  clearWhenFinished?: boolean;
  duration: number;
  speed: number;
  direction: 'forward' | 'backward' | 'left' | 'right';
  note: string;
}
export type TriggerMode = 'appearance' | 'continuous' | 'interval' | 'disappearance';
export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  className: string;
  confidence: number;
  region: DetectionRegion;
  distance: DetectionDistance;
  nearThreshold: number;
  minDuration: number;
  cooldown: number;
  interval: number;
  mode: TriggerMode;
  actions: Action[];
}
export interface VisionSettings {
  confidence: number;
  fps: number;
  visualize: boolean;
  model: string;
}
export interface Project {
  visionProvider: VisionProviderKind;
  teachableMachineUrl?: string;
  version: 1;
  id: string;
  name: string;
  robotType: RobotType;
  vision: VisionSettings;
  rules: Rule[];
  selectedClasses: string[];
}
export const actionDefinitions: Record<ActionKind, { label: string; description: string }> = {
  beak: { label: 'Beak light', description: 'Give your Finch a colorful beak' },
  tailLightSequence: { label: 'Tail light sequence', description: 'Animate selected tail lights in order' },
  tail: { label: 'Tail lights', description: 'Light up all four tail LEDs' },
  move: { label: 'Move', description: 'Move the Finch wheels' },
  sound: { label: 'Play a note', description: 'Show a sound event' },
  wait: { label: 'Wait', description: 'Pause before the next action' },
  stop: { label: 'Stop wheels', description: 'Stop all wheel movement' },
  singleLed: { label: 'Single-color LED', description: 'Set LED brightness' },
  triLed: { label: 'Tri-color LED', description: 'Set an RGB LED color' },
  positionServo: { label: 'Position servo', description: 'Set a servo angle' },
  rotationServo: { label: 'Rotation servo', description: 'Run a continuous rotation servo' },
};
export const makeAction = (kind: ActionKind = 'beak'): Action => ({
  id: crypto.randomUUID(),
  kind,
  enabled: true,
  mode: 'timed',
  ...(['singleLed', 'triLed', 'positionServo', 'rotationServo'].includes(kind) ? { port: 1 } : {}),
  ...(kind === 'singleLed' ? { brightness: 100 } : {}),
  ...(kind === 'positionServo' ? { angle: 90 } : {}),
  color: '#51d691',
  tailLights: kind === 'tail' ? [] : [1, 2, 3, 4],
  ...(kind === 'tailLightSequence' ? sequenceDefaults() : {}),
  duration: 500,
  speed: 40,
  direction: 'forward',
  note: 'C5',
});
export const makeRule = (): Rule => ({
  id: crypto.randomUUID(),
  name: 'Say hello',
  enabled: true,
  className: 'person',
  confidence: 0.7,
  region: 'anywhere',
  distance: 'any',
  nearThreshold: 0.12,
  minDuration: 500,
  cooldown: 2000,
  interval: 3000,
  mode: 'appearance',
  actions: [makeAction()],
});
export const makeProject = (): Project => ({
  visionProvider: 'yolo',
  version: 1,
  id: crypto.randomUUID(),
  name: 'My first vision project',
  robotType: 'finch',
  vision: { confidence: 0.7, fps: 8, visualize: true, model: 'YOLOv8n · COCO' },
  rules: [makeRule()],
  selectedClasses: ['person'],
});



export const sequenceDefaults = () => ({
  steps: ['#51D691', '#4DA3FF', '#FFD84D', '#E83AB8'].map((color, i) => ({ light: i + 1, color })),
  stepDurationMs: 250, repeatCount: 3, clearPrevious: true, clearWhenFinished: true,
});
export function validTailSequence(a: Partial<Action>): boolean {
  return Array.isArray(a.steps) && a.steps.length <= 4 &&
    a.steps.every(s => s && [1, 2, 3, 4].includes(s.light) && typeof s.color === 'string' && /^#[0-9a-f]{6}$/i.test(s.color)) &&
    new Set(a.steps.map(s => s.light)).size === a.steps.length &&
    Number.isInteger(a.repeatCount) && a.repeatCount! >= 1 && a.repeatCount! <= 20 &&
    Number.isInteger(a.stepDurationMs) && a.stepDurationMs! >= 50 && a.stepDurationMs! <= 10000 &&
    typeof a.clearPrevious === 'boolean' && typeof a.clearWhenFinished === 'boolean';
}

