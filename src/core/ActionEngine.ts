import { delay, type RobotAdapter } from './RobotAdapter';
import { validTailSequence } from './types';
import type { Action, Rule } from './types';
type Step = { action: Action; ruleId?: string };
const continuous = (a: Action) => a.kind === 'move' && a.mode === 'continuous';
/** One sequence at a time; busy triggers are dropped, never queued unboundedly. */
export class ActionEngine {
  private controller: AbortController | null = null;
  private running: Promise<boolean> | null = null;
  private activeRuleIds = new Set<string>();
  private revision = 0;
  private motorOwner: string | null = null;
  private pendingMotorOwner: string | null = null;
  get activeMotorOwnerRuleId() { return this.motorOwner; }
  get busy() {
    return this.controller !== null;
  }
  constructor(
    private robot: RobotAdapter,
    private log: (message: string) => void = () => {},
    private onError: () => void = () => {},
  ) {}
  async stop() {
    ++this.revision;
    this.activeRuleIds.clear();
    this.motorOwner = null;
    this.pendingMotorOwner = null;
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
  /** Feed every detection evaluation, including while a normal sequence is busy. */
  async updateRules(triggered: Rule[], active: Rule[]): Promise<boolean> {
    const previous = this.activeRuleIds;
    this.activeRuleIds = new Set(active.map(r => r.id));
    const entering = active.filter(r => !previous.has(r.id));
    const starts = new Set(entering.filter(r => r.actions.some(a => a.enabled && continuous(a))).map(r => r.id));
    const stops = new Set(entering.filter(r => r.actions.some(a => a.enabled && a.kind === 'stop')).map(r => r.id));
    const triggeredIds = new Set(triggered.map(r => r.id));
    const candidates = [...triggered, ...entering.filter(r => !triggeredIds.has(r.id))];
    const steps = candidates.flatMap(r => r.actions.filter(a => a.enabled &&
      (continuous(a) ? starts.has(r.id) : triggeredIds.has(r.id) || (a.kind === 'stop' && stops.has(r.id))))
      .map(action => ({ action, ruleId: r.id })));
    const owner = this.pendingMotorOwner ?? this.motorOwner;
    const ownerLost = owner !== null && !this.activeRuleIds.has(owner);
    const explicitStop = steps.some(s => s.action.kind === 'stop');
    if (starts.size || ownerLost || explicitStop) {
      const revision = ++this.revision;
      this.pendingMotorOwner = [...starts].at(-1) ?? null;
      const previousRun = this.running;
      this.controller?.abort();
      // STOP/release bypass waits and timed actions. Drain their cancellation before a new drive.
      if (explicitStop || (ownerLost && !starts.size)) {
        this.motorOwner = null;
        try { await this.robot.stop(); }
        catch { this.onError(); await this.stop(); return false; }
      }
      await previousRun;
      if (revision !== this.revision) return false;
      this.pendingMotorOwner = null;
    } else if (this.busy) return false;
    if (!steps.length) return true;
    return this.runSteps(steps);
  }
  async run(actions: Action[]): Promise<boolean> {
    return this.runSteps(actions.map(action => ({ action })));
  }
  private runSteps(steps: Step[]): Promise<boolean> {
    if (this.busy) return Promise.resolve(false);
    const task = this.executeSteps(steps);
    this.running = task;
    return task;
  }
  private async executeSteps(steps: Step[]): Promise<boolean> {
    if (this.busy) return false;
    const controller = new AbortController();
    this.controller = controller;
    try {
      for (const { action, ruleId } of steps) {
        if (controller.signal.aborted) break;
        if (!action.enabled) continue;
        if (continuous(action)) {
          if (!ruleId || !this.activeRuleIds.has(ruleId)) continue;
          this.motorOwner = ruleId;
        } else if (action.kind === 'move' || action.kind === 'stop') {
          this.motorOwner = null;
        }
        this.log(
          action.kind === 'beak'
            ? `Beak → ${action.color}`
            : action.kind === 'move'
              ? `Move ${action.direction} → ${continuous(action) ? 'while rule matches' : `${action.duration} ms`}`
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
      this.motorOwner = null;
      if (!controller.signal.aborted) {
        ++this.revision;
        this.activeRuleIds.clear();
        this.pendingMotorOwner = null;
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

