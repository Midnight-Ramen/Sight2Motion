import type { RobotAdapter } from './RobotAdapter';
import type { Action } from './types';
/** Keeps ActionEngine bound to a generic adapter as the UI changes selection. */
export class RobotRouter implements RobotAdapter {
  constructor(public current: RobotAdapter) {}
  get connected() { return this.current.connected ?? false; }
  connect() {
    return this.current.connect();
  }
  disconnect() {
    return this.current.disconnect();
  }
  stop() {
    return this.current.stop();
  }
  stopOutput(key: string) {
    return this.current.stopOutput ? this.current.stopOutput(key) : this.current.stop();
  }
  getCapabilities() {
    return this.current.getCapabilities();
  }
  executeAction(action: Action, signal: AbortSignal) {
    return this.current.executeAction(action, signal);
  }
  async select(adapter: RobotAdapter) {
    try {
      await this.current.disconnect();
    } finally {
      this.current = adapter;
    }
  }
}
