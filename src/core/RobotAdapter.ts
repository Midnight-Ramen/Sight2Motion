import type { Action, ActionKind, MotionMode } from './types';
export interface RobotStatus {
  connector: 'not-detected' | 'detected';
  connection: 'disconnected' | 'connecting' | 'connected' | 'error';
  message: string;
}
export interface RobotAdapter {
  readonly connected?: boolean;
  setWheelSpeeds?(left: number, right: number, duration: number, signal: AbortSignal, mode?: MotionMode): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  stop(): Promise<void>;
  stopOutput?(key: string): Promise<void>;
  getCapabilities(): ActionKind[];
  executeAction(action: Action, signal: AbortSignal): Promise<void>;
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

