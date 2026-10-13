import { AvoidanceTurnDiagnostics, AVOID_TURN_POWER } from '../core/AvoidanceTurnDiagnostics';
import { FINCH_EFFECTIVE_TRACK_WIDTH_CM } from '../core/FinchGeometry';
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { ActionEngine } from '../core/ActionEngine';
import type { RobotAdapter } from '../core/RobotAdapter';
import type { SensorProvider } from '../core/SensorProvider';
import type { SensorState, SensorDescriptor } from '../core/Sensors';
import { SENSOR_MAX_AGE } from '../core/Sensors';
import { FinchNavigation, freshDistance, freshLines, lineDirection, type LineEventMode, type NavigationDiagnostics } from '../core/FinchNavigation';
import { EncoderRecording, encoderPair } from '../core/EncoderRecording';
import { BaseBehaviorCoordinator } from '../core/BaseBehaviorCoordinator';
import { makeAction, makeRule } from '../core/types';
import { reactionSpeed, startVeer, avoidanceRuleThreshold } from '../core/DrivingReactions';
import { ObstacleAvoidance, OBSTACLE_AVOIDANCE, type AvoidancePhase } from '../core/ObstacleAvoidance';
import { NavigationEncoderBarrier } from '../core/NavigationEncoderBarrier';
import { NumericSlider } from './NumericSlider';

export function BaseDrivingControls({ engine, robot, sensors, provider, available, rulesRunning, speed, recording, cancelRef, coordinator, ruleSensors, onActiveChange, onProgramChange }: {
  engine: ActionEngine; robot: RobotAdapter; sensors: SensorState; provider?: SensorProvider;
  available: boolean; rulesRunning: boolean; speed: number; recording: EncoderRecording; cancelRef: MutableRefObject<(() => void) | null>;
  coordinator: BaseBehaviorCoordinator; ruleSensors: SensorDescriptor[]; onActiveChange: (active: boolean) => void; onProgramChange: () => void;
}) {
  const [mode, setMode] = useState('None');
  const [baseSpeed, setBaseSpeed] = useState(20);
  const [target, setTarget] = useState(25), [tolerance, setTolerance] = useState(3);
  const [lineEvent, setLineEvent] = useState<LineEventMode>('stop');
  const [emergency, setEmergency] = useState(true), [emergencyDistance, setEmergencyDistance] = useState(10);
  const [distance, setDistance] = useState(30), [angle, setAngle] = useState(90);
  const [untilValue, setUntilValue] = useState(20), [untilOperator, setUntilOperator] = useState<'lessThan' | 'lessThanOrEqual' | 'greaterThan' | 'greaterThanOrEqual'>('lessThan');
  const [untilSpeed, setUntilSpeed] = useState(30);
  const [status, setStatus] = useState('');
  const [avoidancePhase, setAvoidancePhase] = useState<AvoidancePhase>('IDLE');
  const [avoidanceAbort, setAvoidanceAbort] = useState<string>();
  const [stallSnapshot, setStallSnapshot] = useState<NavigationDiagnostics>();
  const [turnDiagnostics] = useState(() => new AvoidanceTurnDiagnostics());
  const latest = useRef({ sensors, available, emergency, emergencyDistance, mode, baseSpeed });
  latest.current = { sensors, available, emergency, emergencyDistance, mode, baseSpeed };
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
  const [encoderBarrier] = useState(() => new NavigationEncoderBarrier(() => latest.current.sensors));
  const navigationFailure = useRef<string | undefined>(undefined);
  const avoidanceCompletion = useRef<((ok: boolean) => void) | null>(null);
  const [avoidanceNavigation] = useState(() => new FinchNavigation(engine, robot, () => latest.current.sensors,
    () => latest.current.available && !document.hidden && (!avoidance.movingForward || emergencySafe()), message => {
      if (!avoidanceNavigation.active) { navigationFailure.current = message; if (message.includes('encoder progress stalled')) setStallSnapshot(avoidanceNavigation.lastDiagnostics); }
      if (!avoidanceNavigation.active) avoidanceCompletion.current?.(message === 'Navigation complete');
    }));
  const [avoidance] = useState(() => new ObstacleAvoidance({
    sensors: () => latest.current.sensors,
    allowed: () => latest.current.available && !document.hidden,
    unsafe: forward => !forward ? undefined : freshDistance(latest.current.sensors, performance.now()) === null ? 'stale distance before/during forward bypass' : !emergencySafe() ? 'emergency braking: unsafe forward clearance' : undefined,
    phaseChanged: (phase, reason) => { if (phase === 'STOPPING') turnDiagnostics.reset(); if (phase === 'COMPLETE' || phase === 'ABORTED') turnDiagnostics.release(); setAvoidancePhase(phase); setAvoidanceAbort(reason); },
    stop: () => engine.stop(), status: setStatus,
    move: async (command, signal) => {
      navigationFailure.current = undefined; setStallSnapshot(undefined);
      await engine.waitForStops();
      await encoderBarrier.wait(performance.now(), signal);
      const pair = encoderPair(latest.current.sensors, performance.now());
      turnDiagnostics.update(pair); turnDiagnostics.release();
      if (command.kind === 'turn' && pair) turnDiagnostics.begin(avoidance.phase, command.direction, command.amount, pair, AVOID_TURN_POWER);
      const completed = await new Promise<boolean>(resolve => {
        const finish = (ok: boolean) => { signal.removeEventListener('abort', stop); avoidanceCompletion.current = null; resolve(ok); };
        const stop = () => { avoidanceNavigation.cancel(); finish(false); };
        avoidanceCompletion.current = finish;
        signal.addEventListener('abort', stop, { once: true });
        if (signal.aborted) { stop(); return; }
        void avoidanceNavigation.start(command, command.kind === 'turn' ? AVOID_TURN_POWER : latest.current.baseSpeed,
          latest.current.emergency ? latest.current.emergencyDistance : undefined,
          command.kind === 'turn' ? OBSTACLE_AVOIDANCE.minimumTurnSpeed : undefined)
          .then(ok => { if (!ok) finish(false); }).catch(() => finish(false));
      });
      await engine.waitForStops();
      turnDiagnostics.update(encoderPair(latest.current.sensors, performance.now())); turnDiagnostics.finish();
      if (!completed && !signal.aborted) throw new Error(navigationFailure.current ?? 'navigation could not start: check encoders/connection');
      return completed && !signal.aborted;
    },
  }));
  coordinator.assist = {
    shouldTrigger: (_triggered, active) => {
      const threshold = avoidanceRuleThreshold(active);
      if (threshold === undefined || latest.current.mode !== 'Cruise Forward') { avoidance.shouldTrigger(); return false; }
      avoidance.threshold = threshold;
      return avoidance.shouldTrigger();
    },
    run: () => avoidance.run(), reset: () => avoidance.reset(),
    cancel: () => { avoidance.cancel(); avoidanceNavigation.cancel(); },
  };
  const ruleSensorsFresh = () => ruleSensors.every(sensor => {
    const sample = latest.current.sensors[sensor.id];
    const age = sample ? performance.now() - sample.updatedAt : Infinity;
    return !!sample?.reading && age >= 0 && age <= SENSOR_MAX_AGE;
  });
  const cancel = () => {
    suspending.current = true;
    avoidance.cancel(); avoidanceNavigation.cancel();
    reactionAbort.current?.abort(); reactionAbort.current = null;
    const wasNavigating = controller.active;
    controller.cancel();
    const wasCruise = cruise.current;
    cruise.current = false;
    suspending.current = false;
    if (wasCruise || wasNavigating) return engine.stop();
  };
  cancelRef.current = () => { coordinator.disarm(); cancel(); };
  coordinator.safety = () => coordinator.avoiding && !avoidance.movingForward
    ? latest.current.available && !document.hidden
    : (() => {
      const fresh = freshDistance(latest.current.sensors, performance.now()) !== null;
      const safe = emergencySafe() && (!coordinator.avoiding || fresh);
      if (!safe && coordinator.avoiding) avoidance.cancel(!fresh ? 'stale distance during forward bypass' : 'emergency braking: unsafe forward clearance');
      return safe;
    })();
  useEffect(() => { onActiveChange(controller.active || cruise.current || avoidanceNavigation.active); }, [status, controller, onActiveChange]);
  useEffect(() => { turnDiagnostics.update(encoderPair(sensors, performance.now())); void controller.sensorsUpdated(); avoidance.sensorsUpdated(); encoderBarrier.sensorsUpdated(); void avoidanceNavigation.sensorsUpdated(); }, [sensors, controller, avoidance, avoidanceNavigation, encoderBarrier, turnDiagnostics]);
  const priorityKey = ruleSensors.map(sensor => sensor.id).join(',');
  const avoidanceMonitoring = avoidancePhase !== 'IDLE' && avoidancePhase !== 'COMPLETE' && avoidancePhase !== 'ABORTED';
  useEffect(() => {
    const line = controller.lineSensorIds;
    provider?.setPriority(avoidanceMonitoring ? ['finchEncoderLeft', 'finchEncoderRight', 'finchDistance'] : line.length ? [...new Set([...line, ...ruleSensors.map(sensor => sensor.id), ...(emergency ? ['finchDistance'] : [])])] : [], async state => {
      latest.current.sensors = state;
      if (avoidanceMonitoring) { turnDiagnostics.update(encoderPair(state, performance.now())); encoderBarrier.sensorsUpdated(); avoidance.sensorsUpdated(); await avoidanceNavigation.sensorsUpdated(); }
      else await controller.sensorsUpdated(true);
    });
    return () => provider?.setPriority([]);
  }, [status, controller, provider, priorityKey, emergency, avoidanceMonitoring, avoidance, avoidanceNavigation, encoderBarrier, turnDiagnostics]);
  useEffect(() => { if (!available) { coordinator.disarm(); cancel(); } }, [available, coordinator]);
  useEffect(() => {
    const stop = () => { coordinator.disarm(); cancel(); };
    const hidden = () => { if (document.hidden) stop(); };
    window.addEventListener('blur', stop); document.addEventListener('visibilitychange', hidden);
    return () => { stop(); cancelRef.current = null; coordinator.safety = () => true; coordinator.program = undefined; coordinator.assist = undefined; window.removeEventListener('blur', stop); document.removeEventListener('visibilitychange', hidden); };
  }, [controller, coordinator]);
  const startBase = () => {
    if (mode === 'None') { coordinator.disarm(); return; }
    coordinator.arm({
      suspend: cancel,
      safe: () => latest.current.available && !document.hidden && emergencySafe() && ruleSensorsFresh() &&
        (!coordinator.avoiding || freshDistance(latest.current.sensors, performance.now()) !== null) &&
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
  const busy = controller.active || cruise.current || coordinator.avoiding;
  const blocked = !available || busy || !emergencySafe();
  const ready = available && !busy && emergencySafe() && ruleSensorsFresh() && (mode === 'None' ||
    (Number.isFinite(baseSpeed) && baseSpeed >= 1 && baseSpeed <= 100 &&
      (mode !== 'Line Follow' || !!freshLines(sensors, performance.now())) &&
      (mode !== 'Keep Distance' || (!!encoderPair(sensors, performance.now()) && freshDistance(sensors, performance.now()) !== null &&
        Number.isFinite(target) && target > 0 && Number.isFinite(tolerance) && tolerance >= 0 && tolerance < target))));
  coordinator.program = { selected: mode !== 'None', ready: () => ready, start: startBase };
  useEffect(() => { onProgramChange(); }, [ready, mode, onProgramChange]);
  const lineValues = freshLines(sensors, performance.now());
  return <section className="base-driving" aria-label="Base driving">
    <div className="base-heading"><label>Base driving behavior <select aria-label="Base driving behavior" value={mode} disabled={rulesRunning || coordinator.enabled} onChange={event => changeMode(event.target.value)}>
      {['None', 'Cruise Forward', 'Line Follow', 'Keep Distance'].map(value => <option key={value}>{value}</option>)}
    </select></label></div>
    {mode !== 'None' && <div className="base-settings">
      <label>Speed %<NumericSlider aria-label="Base driving speed" min={1} max={100} value={baseSpeed} disabled={busy || coordinator.enabled || rulesRunning} onChange={event => setBaseSpeed(+event.target.value)} /></label>
      {mode === 'Line Follow' && <label>When both sensors see black<select aria-label="Line marker action" disabled={busy || coordinator.enabled || rulesRunning} value={lineEvent} onChange={event => setLineEvent(event.target.value as LineEventMode)}>
        <option value="stop">Stop</option><option value="continue">Continue</option><option value="left">Turn Left</option><option value="right">Turn Right</option>
      </select><small aria-label="Line Follow readings">L: {lineValues?.[0] ?? '—'} R: {lineValues?.[1] ?? '—'} · {lineValues ? lineDirection(...lineValues) : '—'}</small></label>}
      {mode === 'Keep Distance' && <><label>Target <input aria-label="Keep Distance target cm" type="number" min={1} disabled={busy || coordinator.enabled || rulesRunning} value={target} onChange={event => setTarget(+event.target.value)} /> cm</label>
        <label>Tolerance ±<input aria-label="Keep Distance tolerance cm" type="number" min={0} disabled={busy || coordinator.enabled || rulesRunning} value={tolerance} onChange={event => setTolerance(+event.target.value)} /> cm</label></>}
    </div>}
    <div className="navigation-controls">
      <h3>Safety</h3><div><label><input type="checkbox" checked={emergency} disabled={busy || coordinator.enabled || rulesRunning} onChange={event => setEmergency(event.target.checked)} />Emergency braking</label>
        <input aria-label="Emergency stop distance cm" type="number" min={0} disabled={busy || coordinator.enabled || rulesRunning || !emergency} value={emergencyDistance} onChange={event => setEmergencyDistance(+event.target.value)} /> cm</div>
      <div hidden style={{ display: 'none' }}>
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
      </div>
    </div>
    {avoidancePhase !== 'IDLE' && <small aria-label="Avoidance phase">Avoidance: {avoidancePhase}{avoidanceAbort ? ` · Abort: ${avoidanceAbort} · During: ${avoidance.failedPhase ?? 'unknown'}` : ''}</small>}
    {turnDiagnostics.records.length > 0 && <details className="avoidance-turn-diagnostics"><summary>Avoidance turn diagnostics</summary>
      {turnDiagnostics.records.map((turn, index) => <small key={index} style={{ display: 'block' }} aria-label={`Avoidance turn ${turn.phase}`}>
        {turn.phase} � Requested: {turn.requestedAngle}� {turn.direction} � Power: {turn.power}%
        {' � '}Target: {turn.targetRotations.toFixed(3)} rotations / wheel
        {' � '}Actual L/R: {turn.actual.map(value => value.toFixed(3)).join(' / ')} rotations
        {' � '}Over target L/R: {turn.actual.map(value => Math.max(0, Math.abs(value) - turn.targetRotations).toFixed(3)).join(' / ')}
        {' � '}{turn.completed ? 'Turn ended' : 'Turning / interrupted'}
      </small>)}
    </details>}
    {avoidancePhase === 'ABORTED' && stallSnapshot && <small aria-label="Avoidance stall snapshot">
      Wheels L/R: {stallSnapshot.command ?? 'not sent'}% · Progress L/R: {stallSnapshot.progress.map(value => Number.isFinite(value) ? value.toFixed(3) : '—').join(' / ')} / {stallSnapshot.target.toFixed(3)} rotations
      {' · '}Encoder age L/R: {stallSnapshot.encoderAgeMs.map(value => Math.round(value)).join(' / ')} ms
      {' · '}No progress L/R: {stallSnapshot.idleMs.map(value => Math.round(value)).join(' / ')} ms
    </small>}
    <small role="status">{status || (ready ? 'Ready to run' : 'Check connection and sensor readings')}{coordinator.enabled && !busy && !coordinator.avoiding ? ' · Base paused for rule reaction' : ''}</small>
  </section>;
}
