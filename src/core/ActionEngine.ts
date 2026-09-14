import { delay, type RobotAdapter } from './RobotAdapter';
import { validTailSequence } from './types';
import type { Action } from './types';
/** One sequence at a time; busy triggers are dropped, never queued unboundedly. */
export class ActionEngine {
  private controller: AbortController | null = null;
  get busy() {
    return this.controller !== null;
  }
  constructor(
    private robot: RobotAdapter,
    private log: (message: string) => void = () => {},
    private onError: () => void = () => {},
  ) {}
  async stop() {
    this.controller?.abort();
    try {
      await this.robot.stop();
    } catch {
      this.onError();
      this.log(
        'STOP delivery failed. Check the physical robot and use its power button if needed.',
      );
    }
  }
  async run(actions: Action[]): Promise<boolean> {
    if (this.busy) return false;
    const controller = new AbortController();
    this.controller = controller;
    try {
      for (const action of actions) {
        if (controller.signal.aborted) break;
        if (!action.enabled) continue;
        this.log(
          action.kind === 'beak'
            ? `Beak → ${action.color}`
            : action.kind === 'move'
              ? `Move ${action.direction} → ${action.duration} ms`
              : `${action.kind} action`,
        );
        if (action.kind === 'tailLightSequence') {
          if (!validTailSequence(action)) throw new Error('Invalid tail light sequence.');
          const signal = controller.signal;
          const setLight = async (light: number, color: string) => {
            if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
            await this.robot.executeAction({ ...action, kind: 'tail', tailLights: [light], color }, signal);
          };
          for (let repeat = 0; repeat < action.repeatCount!; repeat++) {
            for (const step of action.steps!) {
              await setLight(step.light, step.color);
              await delay(action.stepDurationMs!, signal);
              if (action.clearPrevious) await setLight(step.light, '#000000');
            }
          }
          if (action.clearWhenFinished)
            for (const step of action.steps!) await setLight(step.light, '#000000');
        } else {
          await this.robot.executeAction(action, controller.signal);
        }
      }
      return !controller.signal.aborted;
    } catch {
      if (!controller.signal.aborted) {
        this.onError();
        this.log('Robot paused. Reconnect and try again.');
      }
      try {
        await this.robot.stop();
      } catch {
        this.onError();
        this.log(
          'STOP delivery failed. Check the physical robot and use its power button if needed.',
        );
      }
      return false;
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }
}

