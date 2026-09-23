import { delay, type RobotAdapter } from './RobotAdapter';
import { makeAction, validTailSequence } from './types';
import { FollowController, type TrackedFollowSettings } from './FollowController';
import type { TrackedTarget } from './TargetTracker';
import { followTargets } from './DetectionManager';
import type { Action, Rule, VisionResult } from './types';
import { continuousOutput as continuous, outputKey } from './RobotCapabilities';
type Step = { action: Action; ruleId?: string };
/** One sequence at a time; busy triggers are dropped, never queued unboundedly. */
export class ActionEngine {
  private frameRevision = 0;
  private follow?: { ruleId: string; controller: FollowController };
  private selectedFollow?: FollowController;
  private selectedStart = 0;
  get followingSelectedTarget() { return !!this.selectedFollow; }
  get selectedFollowDiagnostics() { return this.selectedFollow?.diagnostics ?? null; }
  async startSelectedFollow(target: TrackedTarget, capturedAt: number, timeout: number, config: TrackedFollowSettings) {
    const stopping = this.stop();
    const revision = this.revision, start = ++this.selectedStart;
    await stopping;
    await this.running;
    if (revision !== this.revision || start !== this.selectedStart || !this.robot.connected || !this.robot.setWheelSpeeds) return;
    if (target.state !== 'TRACKING' || target.targetLost || target.trackingConfidence < config.minConfidence) return;
    const controller = new FollowController(makeAction('move'),
      (left, right, signal) => this.robot.setWheelSpeeds!(left, right, 0, signal, 'follow'),
      () => { if (this.selectedFollow === controller) void this.stopSelectedFollow(); },
      () => { if (this.selectedFollow === controller) { this.onError(); void this.stop(); } });
    this.selectedFollow = controller;
    await controller.updateTracked(target, capturedAt, timeout, config);
  }
  async updateSelectedTarget(target: TrackedTarget | null, at: number, timeout: number, config: TrackedFollowSettings) {
    if (!target?.active || target.targetLost || target.state === 'LOST') { await this.stopSelectedFollow(); return; }
    await this.selectedFollow?.updateTracked(target, at, timeout, config);
  }
  async stopSelectedFollow() {
    ++this.selectedStart;
    const controller = this.selectedFollow;
    this.selectedFollow = undefined;
    controller?.cancel();
    if (controller) {
      try { await (this.robot.stopOutput ? this.robot.stopOutput('wheels') : this.robot.stop()); }
      catch { this.onError(); await this.stop(); }
    }
  }
  private visionFrame?: { detections: VisionResult[]; width: number; height: number; capturedAt: number };
  private currentRules: Rule[] = [];
  private cancelFollow() { this.follow?.controller.cancel(); this.follow = undefined; }
  private controller: AbortController | null = null;
  private running: Promise<boolean> | null = null;
  private activeRuleIds = new Set<string>();
  private revision = 0;
  private outputOwners = new Map<string, string>();
  private pendingOutputOwners = new Map<string, string>();
  get activeMotorOwnerRuleId() { return this.outputOwners.get('wheels') ?? null; }
  get activeOutputOwners(): ReadonlyMap<string, string> { return new Map(this.outputOwners); }
  get busy() {
    return this.controller !== null;
  }
  constructor(
    private robot: RobotAdapter,
    private log: (message: string) => void = () => {},
    private onError: () => void = () => {},
  ) {}
  async stop() {
    ++this.selectedStart;
    this.selectedFollow?.cancel(); this.selectedFollow = undefined;
    ++this.frameRevision;
    this.cancelFollow();
    ++this.revision;
    this.activeRuleIds.clear();
    this.outputOwners.clear();
    this.pendingOutputOwners.clear();
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
  async updateRules(triggered: Rule[], active: Rule[], frame?: { detections: VisionResult[]; width: number; height: number }): Promise<boolean> {
    ++this.selectedStart;
    if (this.selectedFollow) {
      const revision = this.revision;
      await this.stopSelectedFollow();
      if (revision !== this.revision) return false;
    }
    const frameRevision = ++this.frameRevision;
    const capturedAt = performance.now();
    this.visionFrame = frame ? { ...frame, capturedAt } : undefined;
    this.currentRules = active;
    const result = await this.applyRules(triggered, active);
    if (frameRevision !== this.frameRevision) return result;
    const follow = this.follow;
    const rule = active.find(r => r.id === follow?.ruleId);
    if (frame && follow && rule && this.outputOwners.get('wheels') === rule.id)
      await follow.controller.update(followTargets(rule, frame.detections, frame.width, frame.height), capturedAt);
    return result;
  }
  private async applyRules(triggered: Rule[], active: Rule[]): Promise<boolean> {
    const previous = this.activeRuleIds;
    this.activeRuleIds = new Set(active.map(r => r.id));
    const entering = active.filter(r => !previous.has(r.id));
    const supported = this.robot.getCapabilities();
    const starts = new Set(entering.filter(r => r.actions.some(a => a.enabled && supported.includes(a.kind) && continuous(a))).map(r => r.id));
    const stops = new Set(entering.filter(r => r.actions.some(a => a.enabled && a.kind === 'stop')).map(r => r.id));
    const triggeredIds = new Set(triggered.map(r => r.id));
    const candidates = [...triggered, ...entering.filter(r => !triggeredIds.has(r.id))];
    const steps = candidates.flatMap(r => r.actions.filter(a => a.enabled && supported.includes(a.kind) &&
      (continuous(a) ? starts.has(r.id) : triggeredIds.has(r.id) || (a.kind === 'stop' && stops.has(r.id))))
      .map(action => ({ action, ruleId: r.id })));
    const owners = new Map([...this.outputOwners, ...this.pendingOutputOwners]);
    const lostOutputs = [...owners].filter(([, owner]) => !this.activeRuleIds.has(owner)).map(([key]) => key);
    const replacements = new Map(steps.filter(s => continuous(s.action)).map(s => [outputKey(s.action)!, s.ruleId]));
    const explicitStop = steps.some(s => s.action.kind === 'stop');
    if (starts.size || lostOutputs.length || explicitStop) {
      const revision = ++this.revision;
      this.pendingOutputOwners = replacements;
      const previousRun = this.running;
      this.controller?.abort();
      // STOP/release bypass waits and timed actions. Drain their cancellation before a new drive.
      if (explicitStop || lostOutputs.length) {
        try {
          if (explicitStop) {
            this.cancelFollow();
            this.outputOwners.clear();
            await this.robot.stop();
          } else {
            await Promise.all(lostOutputs.filter(key => !replacements.has(key)).map(async key => {
              if (key === 'wheels') this.cancelFollow();
              this.outputOwners.delete(key);
              if (this.robot.stopOutput) await this.robot.stopOutput(key);
              else await this.robot.stop();
            }));
          }
        }
        catch { this.onError(); await this.stop(); return false; }
      }
      await previousRun;
      if (revision !== this.revision) return false;
      this.pendingOutputOwners.clear();
    } else if (this.busy) return false;
    if (!steps.length) return true;
    return this.runSteps(steps);
  }
  async run(actions: Action[]): Promise<boolean> {
    ++this.selectedStart;
    if (this.selectedFollow) {
      const revision = this.revision;
      await this.stopSelectedFollow();
      if (revision !== this.revision) return false;
    }
    return this.runSteps(actions.map(action => ({ action })));
  }
  async reset(actions: Action[]): Promise<boolean> {
    await this.stop();
    const revision = this.revision;
    await this.running;
    if (revision !== this.revision) return false;
    return this.run(actions);
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
        if (!this.robot.getCapabilities().includes(action.kind)) {
          this.log(`${action.kind} is not available for the selected robot.`);
          continue;
        }
        const key = outputKey(action);
        if (key === 'wheels' || action.kind === 'stop') this.cancelFollow();
        if (continuous(action)) {
          if (!ruleId || !this.activeRuleIds.has(ruleId)) continue;
          this.outputOwners.set(key!, ruleId);
        } else if (action.kind === 'stop') {
          this.outputOwners.clear();
        } else if (key) {
          this.outputOwners.delete(key);
        }
        this.log(
          action.kind === 'beak'
            ? `Beak → ${action.color}`
            : action.kind === 'move'
              ? action.mode === 'follow' ? 'Follow detected target' : `Move ${action.direction} → ${continuous(action) ? 'while rule matches' : `${action.duration} ms`}`
              : `${action.kind} action`,
        );
        if (action.kind === 'move' && action.mode === 'follow') {
          if (!ruleId || !this.robot.setWheelSpeeds || !this.visionFrame) continue;
          const follow = new FollowController(action,
            (left, right, signal) => this.robot.setWheelSpeeds!(left, right, 0, signal, 'follow'),
            () => {
              if (this.follow?.controller !== follow || this.outputOwners.get('wheels') !== ruleId) return;
              this.cancelFollow();
              this.outputOwners.delete('wheels');
              this.activeRuleIds.delete(ruleId);
              void (this.robot.stopOutput ? this.robot.stopOutput('wheels') : this.robot.stop()).catch(() => { this.onError(); void this.stop(); });
            },
            () => { if (this.follow?.controller === follow) { this.onError(); void this.stop(); } });
          this.follow = { ruleId, controller: follow };
          const rule = this.currentRules.find(r => r.id === ruleId);
          if (rule) await follow.update(followTargets(rule, this.visionFrame.detections, this.visionFrame.width, this.visionFrame.height), this.visionFrame.capturedAt);
        } else if (action.kind === 'tailLightSequence') {
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
    } catch (error) {
      // Each timed adapter action stops its own output in finally. A handoff must not stop other outputs.
      if (controller.signal.aborted) return false;
      this.cancelFollow();
      this.outputOwners.clear();
      if (!controller.signal.aborted) {
        ++this.revision;
        this.activeRuleIds.clear();
        this.pendingOutputOwners.clear();
        this.onError();
        this.log(`Robot paused. ${error instanceof Error ? error.message : 'Reconnect and try again.'}`);
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

