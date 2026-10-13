import type { SelectedTargetProgram } from '../core/SelectedTargetProgram';
import { NumericInput } from './NumericInput';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ActionEngine } from '../core/ActionEngine';
import type { TrackedTarget } from '../core/TargetTracker';
import { TRACKED_FOLLOW_DEFAULTS } from '../core/FollowController';

export interface TrackedFollowAccess {
  engine: ActionEngine;
  available: boolean;
  prepare: () => void;
  container: HTMLElement | null;
}
export function TrackedFollowControls({ target, capturedAt, timeout, access, program, container, compact = false, hidden = false }: {
  program?: SelectedTargetProgram; container?: HTMLElement | null;
  compact?: boolean; hidden?: boolean;
  target: TrackedTarget | null; capturedAt: number; timeout: number; access?: TrackedFollowAccess;
}) {
  const { engine, available, prepare } = access ?? {engine:undefined,available:false,prepare:()=>{}};
  const [settings, setSettings] = useState(program?.settings ?? { ...TRACKED_FOLLOW_DEFAULTS });
  const [running, setRunning] = useState(false), [starting, setStarting] = useState(false);
  const [debug, setDebug] = useState(false);
  const [diagnostics, setDiagnostics] = useState(engine?.selectedFollowDiagnostics ?? null);
  useEffect(() => {
    if (program || !engine) return;
    if (!available) { void engine?.stopSelectedFollow(); return; }
    void engine.updateSelectedTarget(target, capturedAt, timeout, settings);
  }, [engine, available, target, capturedAt, timeout, settings, program]);
  useEffect(() => {
    if(!program && !engine)return;
    const timer = setInterval(() => {
      setRunning(program?.active ?? !!engine?.followingSelectedTarget);
      setDiagnostics(debug ? program?.diagnostics ?? engine?.selectedFollowDiagnostics ?? null : null);
    }, 100);
    return () => clearInterval(timer);
  }, [engine, debug, program]);
  useEffect(() => () => { if(!program)void engine?.stopSelectedFollow(); }, [engine, program]);
  const validSettings = program ? program.validSettings : Object.values(settings).every(Number.isFinite) && settings.farArea > 0 && settings.nearArea > settings.farArea;
  const ready = available && target?.state === 'TRACKING' && !target.targetLost && target.trackingConfidence >= settings.minConfidence;
  async function start() {
    if (!engine || !ready || !target || !validSettings) return;
    setStarting(true);
    prepare();
    try { await engine.startSelectedFollow(target, capturedAt, timeout, settings); }
    finally { setStarting(false); setRunning(program?.active ?? !!engine?.followingSelectedTarget); }
  }
  const destination=program ? container : access?.container;
  if (!destination || hidden) return null;
  const currentSettings=program?.settings ?? settings;
  return createPortal(<div className="tracked-follow-controls">
    {!program && !compact && <span>Follow source: Selected SAM target</span>}
    {!program && <button disabled={!ready || !validSettings || running || starting} onClick={() => void start()}>Follow selected target</button>}
    {!program && (!compact || running || starting) && <button disabled={!running && !starting} onClick={() => void engine?.stopSelectedFollow()}>Stop following</button>}
    {!program && (!compact || running) && <span role="status">{running ? 'Following selected target' : 'Follow paused'}</span>}
    <details><summary>Selected-target Follow settings</summary>
      {!program && <small>Starting selected-target Follow pauses rules.</small>}
      <fieldset disabled={running || starting || !!program?.armed}>
        {([
          ['baseSpeed', 'Forward speed %', 0, 50, 1], ['maxSpeed', 'Maximum wheel speed %', 0, 50, 1],
          ['steeringGain', 'Steering gain', 0, 50, 1], ['deadZone', 'Center dead zone', 0, 0.5, 0.01],
          ['farArea', 'Move forward below area', 0.01, 0.9, 0.01], ['nearArea', 'Stop above area', 0.02, 1, 0.01],
          ['minConfidence', 'Minimum tracking confidence', 0, 1, 0.05],
        ] as const).map(([key, label, min, max, step]) => <label key={key}>{label}
          <NumericInput type="number" min={min} max={max} step={step} value={currentSettings[key]}
            onChange={e => { const value = e.currentTarget.valueAsNumber; if (Number.isFinite(value)) { const next={...currentSettings,[key]:Math.min(max,Math.max(min,value))}; if(program)program.configure(next);else setSettings(next); } }} />
        </label>)}
      </fieldset>
      {!validSettings && <span role="alert">Stop area must be greater than the forward area.</span>}
      <label><input type="checkbox" checked={debug} onChange={e => setDebug(e.target.checked)} />Debug Follow</label>
      {debug && diagnostics && <output>Target error: {diagnostics.error.toFixed(2)} · Target area: {diagnostics.area.toFixed(2)} · Forward: {diagnostics.forward.toFixed(0)} · Steering: {diagnostics.steering.toFixed(1)} · Left motor: {diagnostics.left} · Right motor: {diagnostics.right} · Tracking: {diagnostics.tracking}</output>}
    </details>
  </div>, destination);
}
