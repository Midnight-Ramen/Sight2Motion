import type { ActionEngine } from './ActionEngine';
import type { Rule, VisionResult } from './types';

export interface BaseDriver {
  start: () => Promise<boolean>;
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
  private pending = 0;
  private suspension?: Promise<void>;
  safety: () => boolean = () => true;
  constructor(private engine: ActionEngine) {}
  get enabled() { return this.armed; }
  get active() { return this.baseActive; }
  arm(driver: BaseDriver) {
    this.disarm();
    this.driver = driver;
    this.armed = true;
    void this.resume();
  }
  disarm() {
    ++this.revision;
    this.armed = false;
    this.baseActive = false;
    this.driver?.suspend();
    this.driver = undefined;
  }
  private async resume() {
    if (!this.armed || this.baseActive || this.starting || this.reacting || this.pending || this.engine.busy) return;
    const driver = this.driver;
    if (!driver?.safe()) { this.disarm(); return; }
    const revision = this.revision;
    this.starting = true;
    this.baseActive = true;
    try {
      const ok = await driver.start();
      if (revision !== this.revision) return;
      if (!ok) this.disarm();
    } catch { if (revision === this.revision) this.disarm(); }
    finally { this.starting = false; }
  }
  async update(triggered: Rule[], active: Rule[], frame?: { detections: VisionResult[]; capturedAt: number; width: number; height: number }) {
    if (!this.safety()) { this.disarm(); await this.engine.stop(); return; }
    if (this.baseActive && !this.driver?.safe()) { this.disarm(); await this.engine.stop(); return; }
    const revision = this.revision;
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
