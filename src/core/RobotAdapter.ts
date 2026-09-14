import type { Action, ActionKind } from './types';
export interface RobotAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  stop(): Promise<void>;
  getCapabilities(): ActionKind[];
  executeAction(action: Action, signal: AbortSignal): Promise<void>;
}
export interface MockState {
  connected: boolean;
  beak: string;
  tails: string[];
  left: number;
  right: number;
  sound: string | null;
}
export function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Stopped', 'AbortError'));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Stopped', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
export class MockRobotAdapter implements RobotAdapter {
  state: MockState = {
    connected: false,
    beak: '#ccd7d0',
    tails: Array(4).fill('#ccd7d0'),
    left: 0,
    right: 0,
    sound: null,
  };
  constructor(private changed: (state: MockState) => void = () => {}) {}
  private emit() {
    this.changed({ ...this.state, tails: [...this.state.tails] });
  }
  async connect() {
    this.state.connected = true;
    this.emit();
  }
  async disconnect() {
    await this.stop();
    this.state.connected = false;
    this.emit();
  }
  async stop() {
    this.state.left = 0;
    this.state.right = 0;
    this.state.sound = null;
    this.emit();
  }
  getCapabilities(): ActionKind[] {
    return ['beak', 'tail', 'tailLightSequence', 'move', 'sound', 'wait', 'stop'];
  }
  async executeAction(action: Action, signal: AbortSignal) {
    if (!this.state.connected) throw new Error('Connect your mock Finch first.');
    if (signal.aborted) return;
    switch (action.kind) {
      case 'beak':
        this.state.beak = action.color;
        break;
      case 'tail':
        this.state.tails = this.state.tails.map((color, i) => (action.tailLights ?? [1, 2, 3, 4]).includes(i + 1) ? action.color : color);
        break;
      case 'stop':
        await this.stop();
        break;
      case 'move': {
        const s = action.speed;
        this.state.left = action.direction === 'backward' || action.direction === 'left' ? -s : s;
        this.state.right = action.direction === 'backward' || action.direction === 'right' ? -s : s;
        this.emit();
        if (action.mode === 'continuous') break;
        try {
          await delay(action.duration, signal);
        } finally {
          await this.stop();
        }
        break;
      }
      case 'sound':
        this.state.sound = action.note;
        this.emit();
        try {
          await delay(action.duration, signal);
        } finally {
          this.state.sound = null;
          this.emit();
        }
        break;
      case 'wait':
        await delay(action.duration, signal);
        break;
    }
    this.emit();
  }
}


