import { FINCH_EFFECTIVE_TRACK_WIDTH_CM } from '../core/FinchGeometry';
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { ActionEngine } from '../core/ActionEngine';
import type { RobotAdapter } from '../core/RobotAdapter';
import type { SensorProvider } from '../core/SensorProvider';
import type { SensorState, SensorDescriptor } from '../core/Sensors';
import { SENSOR_MAX_AGE } from '../core/Sensors';
import { FinchNavigation, freshDistance, freshLines, lineDirection, type LineEventMode } from '../core/FinchNavigation';
import { EncoderRecording, encoderPair } from '../core/EncoderRecording';
import { BaseBehaviorCoordinator } from '../core/BaseBehaviorCoordinator';
import { makeAction, makeRule } from '../core/types';
import { reactionSpeed, startVeer } from '../core/DrivingReactions';
import { NumericSlider } from './NumericSlider';

export function BaseDrivingControls({ engine, robot, sensors, provider, available, rulesRunning, speed, recording, cancelRef, coordinator, ruleSensors, onActiveChange, onArm }: {
  engine: ActionEngine; robot: RobotAdapter; sensors: SensorState; provider?: SensorProvider;
  available: boolean; rulesRunning: boolean; speed: number; recording: EncoderRecording; cancelRef: MutableRefObject<(() => void) | null>;
  coordinator: BaseBehaviorCoordinator; ruleSensors: SensorDescriptor[]; onActiveChange: (active: boolean) => void; onArm: () => void;
}) {
  const [mode, setMode] = useState('None');
  const [baseSpeed, setBaseSpeed] = useState(20);
  const [target, setTarget] = useState(25), [tolerance, setTolerance] = useState(3);
  const [lineEvent, setLineEvent] = useState<LineEventMode>('stop');
  const [emergency, setEmergency] = useState(false), [emergencyDistance, setEmergencyDistance] = useState(10);
  const [distance, setDistance] = useState(30), [angle, setAngle] = useState(90);
  const [untilValue, setUntilValue] = useState(20), [untilOperator, setUntilOperator] = useState<'lessThan' | 'lessThanOrEqual' | 'greaterThan' | 'greaterThanOrEqual'>('lessThan');
  const [untilSpeed, setUntilSpeed] = useState(30);
  const [status, setStatus] = useState('');
  const latest = useRef({ sensors, available, emergency, emergencyDistance });
  latest.current = { sensors, available, emergency, emergencyDistance };
  const suspending = useRef(false);
  const cruise = useRef(false);
  const reactionAbort = useRef<AbortController | null>(null);
  const [controller] = useState<FinchNavigation>(() => new FinchNavigation(engine, robot, () => latest.current.sensors,
    () => latest.current.available && !document.hidden, message => {
      setStatus(message);
      if (!suspending.current && !controller.active && coordinator.active) coordinator.disarm();
    }));
  const emergencySafe = () => {
    const current = latest.current;
    const reading = freshDistance(current.sensors, performance.now());
    return !current.emergency || (Number.isFinite(current.emergencyDistance) && current.emergencyDistance >= 0 && reading !== null && reading > current.emergencyDistance);
  };
  const ruleSensorsFresh = () => ruleSensors.every(sensor => {
    const sample = latest.current.sensors[sensor.id];
    const age = sample ? performance.now() - sample.updatedAt : Infinity;
    return !!sample?.reading && age >= 0 && age <= SENSOR_MAX_AGE;
  });
  const cancel = () => {
    suspending.current = true;
    reactionAbort.current?.abort(); reactionAbort.current = null;
    const wasNavigating = controller.active;
    controller.cancel();
    const wasCruise = cruise.current;
    cruise.current = false;
    suspending.current = false;
    if (wasCruise || wasNavigating) return engine.stop();
  };
  cancelRef.current = () => { coordinator.disarm(); cancel(); };
  coordinator.safety = emergencySafe;
  useEffect(() => { onActiveChange(controller.active || cruise.current); }, [status, controller, onActiveChange]);
  useEffect(() => { void controller.sensorsUpdated(); }, [sensors, controller]);
  const priorityKey = ruleSensors.map(sensor => sensor.id).join(',');
  useEffect(() => {
    const line = controller.lineSensorIds;
    provider?.setPriority(line.length ? [...new Set([...line, ...ruleSensors.map(sensor => sensor.id), ...(emergency ? ['finchDistance'] : [])])] : [], async state => {
      latest.current.sensors = state; await controller.sensorsUpdated(true);
    });
    return () => provider?.setPriority([]);
  }, [status, controller, provider, priorityKey, emergency]);
  useEffect(() => { if (!available) { coordinator.disarm(); cancel(); } }, [available, coordinator]);
  useEffect(() => {
    const stop = () => { coordinator.disarm(); cancel(); };
    const hidden = () => { if (document.hidden) stop(); };
    window.addEventListener('blur', stop); document.addEventListener('visibilitychange', hidden);
    return () => { stop(); cancelRef.current = null; coordinator.safety = () => true; window.removeEventListener('blur', stop); document.removeEventListener('visibilitychange', hidden); };
  }, [controller, coordinator]);
  const startBase = () => {
    onArm();
    coordinator.arm({
      suspend: cancel,
      safe: () => latest.current.available && !document.hidden && emergencySafe() && ruleSensorsFresh() &&
        (mode !== 'Line Follow' || !!freshLines(latest.current.sensors, performance.now())) &&
        (mode !== 'Keep Distance' || (!!encoderPair(latest.current.sensors, performance.now()) && freshDistance(latest.current.sensors, performance.now()) !== null)),
      start: async override => {
        const speed = reactionSpeed(baseSpeed, override);
        if (override?.kind === 'veerLeft' || override?.kind === 'veerRight') {
          const abort = new AbortController(); reactionAbort.current = abort; cruise.current = true;
          const ok = await startVeer(engine, robot, speed, override.kind, abort.signal);
          setStatus(`${override.kind === 'veerLeft' ? 'Steer Left' : 'Steer Right'} active`);
          return ok;
        }
        if (mode === 'Line Follow') return controller.lineFollow(speed, lineEvent, true);
        if (mode === 'Keep Distance') return controller.keepDistance(target, tolerance, speed);
        if (mode !== 'Cruise Forward') return false;
        const rule = { ...makeRule(), id: `base-cruise-${crypto.randomUUID()}`, actions: [{ ...makeAction('move'), mode: 'continuous' as const, speed }] };
        cruise.current = true;
        const ok = await engine.updateRules([rule], [rule]); setStatus('Cruise Forward active'); return ok;
      },
    });
  };
  const changeMode = (value: string) => { coordinator.disarm(); cancel(); setMode(value); setStatus(''); };
  const busy = controller.active || cruise.current;
  const blocked = !available || busy || !emergencySafe();
  const lineValues = freshLines(sensors, performance.now());
  return <section className="base-driving" aria-label="Base driving">
    <div className="base-heading"><label>Base driving behavior <select aria-label="Base driving behavior" value={mode} onChange={event => changeMode(event.target.value)}>
      {['None', 'Cruise Forward', 'Line Follow', 'Keep Distance'].map(value => <option key={value}>{value}</option>)}
    </select></label></div>
    {mode !== 'None' && <div className="base-settings">
      <label>Speed %<NumericSlider aria-label="Base driving speed" min={1} max={100} value={baseSpeed} disabled={busy || coordinator.enabled} onChange={event => setBaseSpeed(+event.target.value)} /></label>
      {mode === 'Line Follow' && <label>When both sensors see black<select aria-label="Line marker action" disabled={busy || coordinator.enabled} value={lineEvent} onChange={event => setLineEvent(event.target.value as LineEventMode)}>
        <option value="stop">Stop</option><option value="continue">Continue</option><option value="left">Turn Left</option><option value="right">Turn Right</option>
      </select><small aria-label="Line Follow readings">L: {lineValues?.[0] ?? '—'} R: {lineValues?.[1] ?? '—'} · {lineValues ? lineDirection(...lineValues) : '—'}</small></label>}
      {mode === 'Keep Distance' && <><label>Target <input aria-label="Keep Distance target cm" type="number" min={1} disabled={busy || coordinator.enabled} value={target} onChange={event => setTarget(+event.target.value)} /> cm</label>
        <label>Tolerance ±<input aria-label="Keep Distance tolerance cm" type="number" min={0} disabled={busy || coordinator.enabled} value={tolerance} onChange={event => setTolerance(+event.target.value)} /> cm</label></>}
      <button disabled={blocked || coordinator.enabled || !ruleSensorsFresh() || baseSpeed < 1 || baseSpeed > 100 ||
        (mode === 'Line Follow' && !freshLines(sensors, performance.now())) ||
        (mode === 'Keep Distance' && (!encoderPair(sensors, performance.now()) || freshDistance(sensors, performance.now()) === null || target <= 0 || tolerance < 0 || tolerance >= target))}
        onClick={startBase}>Start base behavior</button>
    </div>}
    <details className="driving-tools"><summary>Navigation &amp; safety</summary><div className="navigation-controls">
      <h3>Safety</h3><div><label><input type="checkbox" checked={emergency} disabled={busy || coordinator.enabled} onChange={event => setEmergency(event.target.checked)} />Emergency braking</label>
        <input aria-label="Emergency stop distance cm" type="number" min={0} disabled={busy || coordinator.enabled || !emergency} value={emergencyDistance} onChange={event => setEmergencyDistance(+event.target.value)} /> cm</div>
      <h3>Navigation</h3><div><label>Drive distance <input aria-label="Drive distance cm" type="number" min={1} max={200} value={distance} onChange={event => setDistance(+event.target.value)} /> cm</label>
        <button disabled={blocked || rulesRunning || coordinator.enabled || !encoderPair(sensors, performance.now())} onClick={() => void controller.start({ kind: 'distance', direction: 'forward', amount: distance }, speed, emergency ? emergencyDistance : undefined)}>Forward</button>
        <button disabled={blocked || rulesRunning || coordinator.enabled || !encoderPair(sensors, performance.now())} onClick={() => void controller.start({ kind: 'distance', direction: 'backward', amount: distance }, speed)}>Backward</button></div>
      <div><label>Turn <input aria-label="Turn angle degrees" type="number" min={1} max={360} value={angle} onChange={event => setAngle(+event.target.value)} /> °</label>
        {(['left', 'right'] as const).map(direction => <button key={direction} disabled={blocked || rulesRunning || coordinator.enabled || !FINCH_EFFECTIVE_TRACK_WIDTH_CM || !encoderPair(sensors, performance.now())} onClick={() => void controller.start({ kind: 'turn', direction, amount: angle }, speed)}>Turn {direction === 'left' ? 'Left' : 'Right'}</button>)}</div>
      <div><button disabled={blocked || rulesRunning || coordinator.enabled || !encoderPair(sensors, performance.now()) || !recording.origin || !recording.segments.length} onClick={() => void controller.returnToBase(recording, speed)}>Return to Base</button><small>Experimental</small></div>
      <details><summary>Drive Until</summary><div><select aria-label="Drive Until operator" value={untilOperator} onChange={event => setUntilOperator(event.target.value as typeof untilOperator)}><option value="lessThan">&lt;</option><option value="lessThanOrEqual">≤</option><option value="greaterThan">&gt;</option><option value="greaterThanOrEqual">≥</option></select>
        <input aria-label="Drive Until distance cm" type="number" min={0} value={untilValue} onChange={event => setUntilValue(+event.target.value)} /> cm
        <label>Speed %<NumericSlider aria-label="Drive Until speed" min={1} max={100} value={untilSpeed} onChange={event => setUntilSpeed(+event.target.value)} /></label>
        <button disabled={blocked || rulesRunning || coordinator.enabled || !encoderPair(sensors, performance.now()) || freshDistance(sensors, performance.now()) === null} onClick={() => void controller.driveUntil({ operator: untilOperator, value: untilValue }, untilSpeed, emergency ? emergencyDistance : undefined)}>Start Drive Until</button></div></details>
    </div></details>
    <small role="status">{status}{coordinator.enabled && !busy ? ' · Base paused for rule reaction' : ''}</small>
  </section>;
}
