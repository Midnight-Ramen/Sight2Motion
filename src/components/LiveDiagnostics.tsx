import type { Project, VisionResult } from '../core/types';
import type { TrackedTarget } from '../core/TargetTracker';
import type { ActionEngine } from '../core/ActionEngine';
import { SENSOR_MAX_AGE, type SensorState } from '../core/Sensors';
import { DEFAULT_NEAR_THRESHOLD } from '../core/DetectionDistance';
import { detectionRegion } from '../core/DetectionRegions';

interface Props {
  project: Project; detections: VisionResult[]; target: TrackedTarget | null;
  sensors: SensorState; ruleResults: Readonly<Record<string, 'TRUE' | 'FALSE' | 'Waiting'>>;
  follow: ActionEngine['followSnapshot']; camera: boolean; model: boolean; robot: boolean;
  running: boolean; fps: number; demo: boolean; now?: number;
}
const percent = (value: number) => Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—';
export function LiveDiagnostics({ project, detections, target, sensors, ruleResults, follow,
  camera, model, robot, running, fps, demo, now = performance.now() }: Props) {
  const classifier = project.visionProvider === 'teachable-machine';
  const items = [...detections].filter(d => classifier || project.selectedClasses.includes(d.className))
    .sort((a, b) => b.confidence - a.confidence);
  const showFollow = project.robotType === 'finch' && (target || project.rules.some(r => r.actions.some(a => a.kind === 'move' && a.mode === 'follow')));
  const wheels = follow.active ? follow.wheels : null;
  return <details className="live-diagnostics panel">
    <summary>Live Diagnostics</summary>
    <div className="diagnostics-sections">
      {(model || demo) && <section aria-label="Vision diagnostics"><h3>Vision</h3>
        {items.length ? <ul>{items.map((d, i) => <li key={`${d.className}-${i}`}>
          <strong>{d.className}</strong> · {percent(d.confidence)}
          {!classifier && <> · {d.region?.toUpperCase() ?? '—'} · {d.areaRatio === undefined ? '—' : d.areaRatio >= DEFAULT_NEAR_THRESHOLD ? 'NEAR' : 'FAR'}</>}
        </li>)}</ul> : <p>{classifier ? 'Waiting for class probabilities.' : 'No selected objects detected.'}</p>}
        {!classifier && <small>Near/Far estimates image size (12% threshold). Rules may use a different threshold.</small>}
      </section>}
      {(target || !!project.customObjects?.length) && <section aria-label="Selected target diagnostics"><h3>Selected Target</h3>
        <p>Target: {target?.displayName || target?.label || 'Not Selected'}</p>
        <p>Status: {!target ? 'Not Selected' : target.state === 'TRACKING' ? 'Tracking' : target.state === 'TEMPORARILY_LOST' ? 'Temporarily Lost' : target.state === 'LOST' ? 'Lost' : 'Not Selected'}</p>
        {target && <><p>Confidence: {percent(target.trackingConfidence)} · Position: {detectionRegion({ x: target.relativeX, width: 0 }, 1).toUpperCase()}</p>
          <p>Size: {percent(target.normalizedArea)} · Center: {percent(target.relativeX)}, {percent(target.relativeY)}</p></>}
      </section>}
      {showFollow && <section aria-label="Follow diagnostics"><h3>Follow</h3>
        <p>Follow: {follow.active ? follow.waiting || follow.selected && target?.state !== 'TRACKING' ? 'Waiting for target' : 'Active' : 'Inactive'}</p>
        {follow.active && <><p>Target: {follow.selected ? target?.displayName || target?.label : follow.target}</p>
          {wheels && <><p>Steering: {wheels[0] === wheels[1] ? 'Straight' : wheels[0] < wheels[1] ? 'Left' : 'Right'}</p>
            <p>Forward speed: {Math.round((wheels[0] + wheels[1]) / 2)}% · Left wheel: {wheels[0]}% · Right wheel: {wheels[1]}%</p></>}
          <small>Last commanded speeds, not measured motion.</small></>}
      </section>}
      {project.robotType === 'hummingbird' && !!project.sensorConfiguration?.length && <section aria-label="Sensor diagnostics"><h3>Sensors</h3>
        <ul>{project.sensorConfiguration.map(sensor => {
          const sample = sensors[sensor.id];
          const reading = robot && sample && now >= sample.updatedAt && now - sample.updatedAt <= SENSOR_MAX_AGE ? sample.reading : null;
          return <li key={sensor.id}>{sensor.label}: {reading ? reading.kind === 'boolean' ? reading.value ? 'Pressed' : 'Not pressed' : `${reading.value} ${reading.unit ?? sensor.unit ?? ''}` : 'No data'}</li>;
        })}</ul>
      </section>}
      {!!project.rules.length && <section aria-label="Rule diagnostics"><h3>Rules</h3>
        <ul>{project.rules.map((rule, i) => <li key={rule.id}>Rule {i + 1} · {rule.name}: {running && robot && rule.enabled ? ruleResults[rule.id] ?? 'Waiting' : 'Waiting'}{!rule.enabled ? ' — Disabled' : !running ? ' — Press Play to evaluate' : ''}</li>)}</ul>
        <small>TRUE means the condition has qualified; trigger timing still applies.</small>
      </section>}
      <section aria-label="System diagnostics"><h3>System</h3><p>Camera: {demo ? 'Demo' : camera ? 'Connected' : 'Not started'}</p>
        <p>AI: {model ? 'Ready' : 'Not ready'}</p><p>Robot: {robot ? 'Connected' : 'Disconnected'}</p><p>Inference: {fps.toFixed(1)} FPS{demo ? ' (simulated)' : ''}</p>
      </section>
    </div>
  </details>;
}
