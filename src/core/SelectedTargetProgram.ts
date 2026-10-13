import { REACQUISITION } from './AppearanceTracker';
import type { ActionEngine } from './ActionEngine';
import { TRACKED_FOLLOW_DEFAULTS, type TrackedFollowSettings } from './FollowController';
import type { TrackedTarget } from './TargetTracker';
import type { TargetProfile } from './TargetProfiles';

export interface SelectedTargetSource {
  profile?: TargetProfile;
  cancelMatch?: () => void;
  canMatch: () => boolean;
  match: () => TrackedTarget | null;
}
/** Base-program adapter only: matching stays in the existing profile tracker,
 * wheel control and the loss watchdog stay in ActionEngine/FollowController. */
export class SelectedTargetProgram {
  private recoverySince: number | null = null;
  private recoveryResume = false;
  private recoveryStop: Promise<void> = Promise.resolve();
  private owner?: symbol;
  private source?: SelectedTargetSource;
  private target: TrackedTarget | null = null;
  private capturedAt = -Infinity;
  private timeout = 750;
  private session = false;
  private driving = false;
  private starting = false;
  private revision = 0;
  settings: TrackedFollowSettings = {...TRACKED_FOLLOW_DEFAULTS};
  status = '';
  constructor(private engine: ActionEngine, private aborted: () => void, private changed: () => void = () => {}) {}
  get configured() { return !!this.source?.profile?.references.length; }
  get label() { return this.source?.profile?.label; }
  get ready() { return this.configured && !!this.source?.canMatch() && this.validSettings; }
  get active() { return this.driving; }
  get diagnostics() { return this.engine.selectedFollowDiagnostics; }
  get armed() { return this.session; }
  get validSettings() {
    const s=this.settings;
    return Object.values(s).every(Number.isFinite) && s.baseSpeed>=0 && s.baseSpeed<=50 &&
      s.maxSpeed>=0 && s.maxSpeed<=50 && s.farArea>0 && s.nearArea>s.farArea;
  }
  setSource(owner: symbol, source: SelectedTargetSource) {
    this.owner=owner;this.source=source;this.changed();
  }
  clearSource(owner: symbol) {
    if(this.owner!==owner)return;
    this.source?.cancelMatch?.();
    this.owner=undefined;this.source=undefined;this.target=null;
    if(this.session)this.fail('Target profile unavailable.');
    this.changed();
  }
  configure(settings: TrackedFollowSettings) {
    if(this.session)return;
    this.settings={...settings};this.changed();
  }
  private fresh() {
    const at=this.target?.lastSeenAt ?? this.capturedAt,age=performance.now()-at;
    return !!this.target?.active && !this.target.targetLost && this.target.state!=='LOST' &&
      this.target.displayName===this.label && Number.isFinite(age) && age>=0 && age<this.timeout;
  }
  get safe() {
    return this.session && this.ready && (this.recoverySince!==null
      ? performance.now()-this.recoverySince<REACQUISITION.windowMs && !this.target?.targetLost
      : this.fresh());
  }
  /** Only an explicit global Play creates a fresh match session. */
  begin(): boolean {
    this.end();this.status='';
    if(!this.ready)return false;
    const target=this.source!.match();
    this.target=target;this.capturedAt=target?.lastSeenAt ?? -Infinity;
    if(!this.fresh() || target?.state!=='TRACKING' || target.trackingConfidence<this.settings.minConfidence) {
      this.status='No confident target match.';this.changed();return false;
    }
    this.session=true;this.changed();return true;
  }
  /** Rules may suspend/resume the same safe match session; never initialize again. */
  async resume(speed=this.settings.baseSpeed): Promise<boolean> {
    if(!this.safe)return false;
    if(this.recoverySince!==null){this.recoveryResume=true;return true;}
    if(this.target?.state!=='TRACKING')return false;
    const revision=++this.revision;this.driving=true;this.starting=true;
    try {
      await this.engine.startSelectedFollow(this.target,this.capturedAt,this.timeout,{...this.settings,baseSpeed:speed});
      if(revision!==this.revision)return this.safe && !this.driving;
      this.starting=false;
      if(!this.engine.followingSelectedTarget){this.fail('Target Follow stopped.');return false;}
      await this.engine.updateSelectedTarget(this.target,this.capturedAt,this.timeout,{...this.settings,baseSpeed:speed});
      return revision===this.revision ? this.engine.followingSelectedTarget : this.safe && !this.driving;
    } catch { if(revision===this.revision)this.fail('Target Follow stopped.');return false; }
  }
  suspend() {
    this.recoveryResume=false;
    ++this.revision;this.driving=false;this.starting=false;
    return this.engine.stopSelectedFollow();
  }
  end() { this.source?.cancelMatch?.();this.recoverySince=null;this.recoveryResume=false;this.session=false;void this.suspend(); }
  private fail(message: string) { this.status=message;this.end();this.changed();this.aborted(); }
  async publish(target: TrackedTarget | null, capturedAt: number, timeout: number) {
    this.target=target;this.capturedAt=capturedAt;this.timeout=timeout;
    if(!this.session)return;
    if(target && !target.targetLost && (target.state==='REACQUIRING' || target.state==='TEMPORARILY_LOST')) {
      if(this.recoverySince===null) {
        this.recoverySince=performance.now();
        const resume=this.driving;
        this.recoveryStop=Promise.resolve(this.suspend());
        this.recoveryResume=resume;
        this.status=`${this.label} · Reacquiring…`;this.changed();
      }
      if(!this.safe)this.fail('Target lost. Press Play to match again.');
      await this.recoveryStop;
      return;
    }
    if(this.recoverySince!==null && target?.state==='TRACKING') {
      if(!this.safe || !this.fresh()){this.fail('Target lost. Press Play to match again.');return;}
      const revision=this.revision;
      await this.recoveryStop;
      if(!this.session || revision!==this.revision)return;
      const resume=this.recoveryResume;
      this.recoverySince=null;this.recoveryResume=false;
      this.status=`${this.label} · Reacquired`;this.changed();
      if(resume)await this.resume(this.currentSettings.baseSpeed);
      return;
    }
    if(!this.fresh()){this.fail('Target lost. Press Play to match again.');return;}
    if(!this.driving || this.starting)return;
    if(!this.engine.followingSelectedTarget){this.fail('Target lost. Press Play to match again.');return;}
    await this.engine.updateSelectedTarget(target,capturedAt,timeout,this.currentSettings);
  }
  private currentSettings: TrackedFollowSettings = {...TRACKED_FOLLOW_DEFAULTS};
  // Preserve a temporary rule speed for subsequent target samples.
  async start(speed=this.settings.baseSpeed) {
    this.currentSettings={...this.settings,baseSpeed:speed};
    return this.resume(speed);
  }
}
