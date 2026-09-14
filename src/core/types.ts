export interface Detection {
  className: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}
export type ActionKind = 'beak' | 'tail' | 'move' | 'sound' | 'wait' | 'stop';
export interface Action {
  id: string;
  kind: ActionKind;
  enabled: boolean;
  color: string;
  tailLights?: number[];
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
  version: 1;
  id: string;
  name: string;
  robotType: 'mock-finch';
  vision: VisionSettings;
  rules: Rule[];
  selectedClasses: string[];
}
export const actionDefinitions: Record<ActionKind, { label: string; description: string }> = {
  beak: { label: 'Beak light', description: 'Give your Finch a colorful beak' },
  tail: { label: 'Tail lights', description: 'Light up all four tail LEDs' },
  move: { label: 'Move', description: 'Move the simulated wheels' },
  sound: { label: 'Play a note', description: 'Show a sound event' },
  wait: { label: 'Wait', description: 'Pause before the next action' },
  stop: { label: 'Stop wheels', description: 'Stop all wheel movement' },
};
export const makeAction = (kind: ActionKind = 'beak'): Action => ({
  id: crypto.randomUUID(),
  kind,
  enabled: true,
  color: '#51d691',
  tailLights: kind === 'tail' ? [] : [1, 2, 3, 4],
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
  minDuration: 500,
  cooldown: 2000,
  interval: 3000,
  mode: 'appearance',
  actions: [makeAction()],
});
export const makeProject = (): Project => ({
  version: 1,
  id: crypto.randomUUID(),
  name: 'My first vision project',
  robotType: 'mock-finch',
  vision: { confidence: 0.7, fps: 8, visualize: true, model: 'YOLOv8n · COCO' },
  rules: [makeRule()],
  selectedClasses: ['person'],
});


