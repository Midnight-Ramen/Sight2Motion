import type { ActionEngine } from './ActionEngine';
import type { Rule, VisionResult } from './types';
import { drivingOverride, engineRules, overrideKey, type DrivingOverride } from './DrivingReactions';

export interface BaseDriver {
  start: (override?: DrivingOverride) => Promise<boolean>;
  suspend: () => void | Promise<void>;
  safe: () => boolean;
}
/** Arbitration only; existing engines remain responsible for rules and motion. */
export class BaseBehaviorCoordinator {
  private driver?: BaseDriver;
  private revision = 0;
  private armed = false;
  private baseActive = false;
  private starting = false;
  private reacting = false;
  private auxiliaryActive = false;
  private pending = 0;
  private suspension?: Promise<void>;
  private override?: DrivingOverride;
  private suppressed = new Set<string>();
  private resumeCommands = new Set<string>();
  assist?: { shouldTrigger: (triggered: Rule[], active: Rule[]) => boolean; run: () => Promise<boolean>; cancel: () => void; reset: () => void };
  private assisting = false;
  get avoiding() { return this.assisting; }
  program?: { selected: boolean; requiresCamera?: boolean; ready: () => boolean; start: () => boolean | void };
  get programReady() { return this.program?.ready() ?? true; }
  startProgram(): boolean {
    if (!this.programReady) return false;
    return this.program?.start() !== false;
  }
  safety: () => boolean = () => true;
  constructor(private engine: ActionEngine) {}
  get enabled() { return this.armed; }
  get active() { return this.baseActive; }
  arm(driver: BaseDriver) {
    this.disarm();
    this.assist?.reset();
    this.driver = driver;
    this.override = undefined;
    this.suppressed.clear(); this.resumeCommands.clear();
    this.reacting = false;
    this.armed = true;
    void this.resume();
  }
  disarm() {
    ++this.revision;
    this.assist?.cancel();
    this.assisting = false;
    this.armed = false;
    this.baseActive = false;
    this.driver?.suspend();
    this.driver = undefined;
    this.override = undefined;
    this.suppressed.clear(); this.resumeCommands.clear();
  }
  private async resume() {
    if (this.assisting || !this.armed || this.baseActive || this.starting || this.reacting || this.pending || this.engine.busy) return;
    const driver = this.driver;
    if (!driver?.safe()) { this.disarm(); return; }
    const revision = this.revision;
    this.starting = true;
    this.baseActive = true;
    try {
      const ok = await driver.start(this.override);
      if (revision !== this.revision) return;
      if (!ok) this.disarm();
    } catch { if (revision === this.revision) this.disarm(); }
    finally { this.starting = false; if (revision !== this.revision && this.armed) void this.resume(); }
  }
  async update(triggered: Rule[], active: Rule[], frame?: { detections: VisionResult[]; capturedAt: number; width: number; height: number }) {
    if (!this.safety()) { this.disarm(); await this.engine.stop(); return; }
    if (this.baseActive && !this.driver?.safe()) { this.disarm(); await this.engine.stop(); return; }
    if (this.assisting) return;
    if (this.armed && this.assist?.shouldTrigger(triggered, active)) {
      const assist = this.assist, revision = ++this.revision;
      this.assisting = true; this.baseActive = false;
      void (async () => {
        try {
          await this.driver?.suspend(); await this.engine.stop();
          if (revision !== this.revision) return;
          const ok = await assist.run();
          if (revision !== this.revision) return;
          this.assisting = false;
          if (!ok) { this.disarm(); await this.engine.stop(); }
          // A subsequent existing evaluation applies current rules before base resume.
        } catch { if (revision === this.revision) { this.disarm(); await this.engine.stop(); } }
      })();
      return;
    }
    const activeActions = active.flatMap(rule => rule.actions).filter(action => action.enabled);
    const activeIds = new Set(activeActions.map(action => action.id));
    for (const id of this.suppressed) if (!activeIds.has(id)) this.suppressed.delete(id);
    for (const id of this.resumeCommands) if (!activeIds.has(id)) this.resumeCommands.delete(id);
    const commands = [...activeActions, ...triggered.flatMap(rule => rule.actions)].filter(action => action.enabled && action.kind === 'resumeBase');
    const resumeRequested = commands.some(action => !this.resumeCommands.has(action.id));
    if (resumeRequested && this.armed) {
      commands.forEach(action => this.resumeCommands.add(action.id));
      activeActions.filter(action => action.kind === 'move' || ['slowDown', 'setSpeed', 'veerLeft', 'veerRight'].includes(action.kind))
        .forEach(action => this.suppressed.add(action.id));
    }
    const desired = drivingOverride(active, triggered, this.suppressed);
    const changed = overrideKey(desired) !== overrideKey(this.override);
    this.override = desired;
    if ((changed || resumeRequested) && this.armed) {
      ++this.revision;
      if (this.baseActive) {
        this.baseActive = false;
        this.suspension = Promise.resolve(this.driver?.suspend());
      }
      if (resumeRequested) this.suspension = Promise.resolve(this.suspension).then(() => this.engine.stop());
    }
    triggered = engineRules(triggered, this.suppressed);
    active = engineRules(active, this.suppressed);
    const revision = this.revision;
    const affectsMotion = [...triggered, ...active].some(rule => rule.actions.some(action =>
      action.enabled && (action.kind === 'move' || action.kind === 'stop')));
    if (this.baseActive && !affectsMotion) {
      // Lights/sound must not cancel navigation or release its ActionEngine wheel owner.
      if (triggered.length || active.length || this.auxiliaryActive) {
        this.auxiliaryActive = active.length > 0;
        await this.engine.updateAuxiliaryRules(triggered, active);
      }
      return;
    }
    const holding = active.some(rule => rule.mode === 'continuous' || rule.actions.some(action => action.enabled &&
      (action.kind === 'stop' || action.mode === 'continuous' || action.mode === 'follow')));
    this.reacting = !!(triggered.length || holding || (!this.baseActive && this.engine.busy));
    // Feeding an empty rule set into ActionEngine would release the base owner.
    if (!this.reacting && this.baseActive) return;
    if (this.reacting && this.baseActive) {
      this.baseActive = false;
      this.suspension = Promise.resolve(this.driver?.suspend());
    }
    ++this.pending;
    try {
      await this.suspension;
      if (revision !== this.revision) return;
      await this.engine.updateRules(triggered, active, frame);
    }
    finally { --this.pending; }
    if (revision === this.revision) await this.resume();
  }
}
