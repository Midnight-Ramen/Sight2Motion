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
export function TrackedFollowControls({ target, capturedAt, timeout, access }: {
  target: TrackedTarget | null; capturedAt: number; timeout: number; access: TrackedFollowAccess;
}) {
  const { engine, available, prepare } = access;
  const [settings, setSettings] = useState({ ...TRACKED_FOLLOW_DEFAULTS });
  const [running, setRunning] = useState(false), [starting, setStarting] = useState(false);
  const [debug, setDebug] = useState(false);
  const [diagnostics, setDiagnostics] = useState(engine.selectedFollowDiagnostics);
  useEffect(() => {
    if (!available) { void engine.stopSelectedFollow(); return; }
    void engine.updateSelectedTarget(target, capturedAt, timeout, settings);
  }, [engine, available, target, capturedAt, timeout, settings]);
  useEffect(() => {
    const timer = setInterval(() => {
      setRunning(engine.followingSelectedTarget);
      setDiagnostics(debug ? engine.selectedFollowDiagnostics : null);
    }, 100);
    return () => clearInterval(timer);
  }, [engine, debug]);
  useEffect(() => () => { void engine.stopSelectedFollow(); }, [engine]);
  const validSettings = Object.values(settings).every(Number.isFinite) && settings.farArea > 0 && settings.nearArea > settings.farArea;
  const ready = available && target?.state === 'TRACKING' && !target.targetLost && target.trackingConfidence >= settings.minConfidence;
  async function start() {
    if (!ready || !target || !validSettings) return;
    setStarting(true);
    prepare();
    try { await engine.startSelectedFollow(target, capturedAt, timeout, settings); }
    finally { setStarting(false); setRunning(engine.followingSelectedTarget); }
  }
  if (!access.container) return null;
  return createPortal(<div className="tracked-follow-controls">
    <span>Follow source: Selected SAM target</span>
    <button disabled={!ready || !validSettings || running || starting} onClick={() => void start()}>Follow selected target</button>
    <button disabled={!running && !starting} onClick={() => void engine.stopSelectedFollow()}>Stop following</button>
    <span role="status">{running ? 'Following selected target' : 'Follow paused'}</span>
    <small>Class-based Follow remains available in rules. Starting selected-target Follow pauses rules.</small>
    <details><summary>Selected-target Follow settings</summary>
      <fieldset disabled={running || starting}>
        {([
          ['baseSpeed', 'Forward speed %', 0, 50, 1], ['maxSpeed', 'Maximum wheel speed %', 0, 50, 1],
          ['steeringGain', 'Steering gain', 0, 50, 1], ['deadZone', 'Center dead zone', 0, 0.5, 0.01],
          ['farArea', 'Move forward below area', 0.01, 0.9, 0.01], ['nearArea', 'Stop above area', 0.02, 1, 0.01],
          ['minConfidence', 'Minimum tracking confidence', 0, 1, 0.05],
        ] as const).map(([key, label, min, max, step]) => <label key={key}>{label}
          <input type="number" min={min} max={max} step={step} value={settings[key]}
            onChange={e => { const value = e.currentTarget.valueAsNumber; if (Number.isFinite(value)) setSettings(old => ({ ...old, [key]: Math.min(max, Math.max(min, value)) })); }} />
        </label>)}
      </fieldset>
      {!validSettings && <span role="alert">Stop area must be greater than the forward area.</span>}
      <label><input type="checkbox" checked={debug} onChange={e => setDebug(e.target.checked)} />Debug Follow</label>
      {debug && diagnostics && <output>Target error: {diagnostics.error.toFixed(2)} · Target area: {diagnostics.area.toFixed(2)} · Forward: {diagnostics.forward.toFixed(0)} · Steering: {diagnostics.steering.toFixed(1)} · Left motor: {diagnostics.left} · Right motor: {diagnostics.right} · Tracking: {diagnostics.tracking}</output>}
    </details>
  </div>, access.container);
}
