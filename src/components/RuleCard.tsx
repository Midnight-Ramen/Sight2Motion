import { ArrowDown, ArrowUp, GripVertical, Lightbulb, Plus, Trash2 } from 'lucide-react';
import {
  actionDefinitions,
  makeAction,
  sequenceDefaults,
  type Action,
  type ActionKind,
  type Rule,
  type VisionResult,
} from '../core/types';
import { objectLabel } from '../core/ProjectObjects';
import { SensorConditions } from './SensorConditions';
import type { SensorDescriptor } from '../core/Sensors';
import { FOLLOW_DEFAULTS } from '../core/FollowController';
import { portsFor } from '../core/RobotCapabilities';
import { classificationRule, compatibleRule, YOLO_CAPABILITIES, type VisionCapabilities } from '../core/VisionCapabilities';
export function RuleCard({
  rule,
  index,
  onChange,
  onDelete,
  capabilities,
  selectedClasses,
  detections = [],
  visionCapabilities = YOLO_CAPABILITIES,
  robotName = 'Finch 2',
  sensors = [],
  sensorsAvailable = false,
}: {
  detections?: VisionResult[];
  visionCapabilities?: VisionCapabilities;
  robotName?: string;
  sensors?: SensorDescriptor[];
  sensorsAvailable?: boolean;
  selectedClasses: string[];
  rule: Rule;
  index: number;
  onChange: (r: Rule) => void;
  onDelete: () => void;
  capabilities: ActionKind[];
}) {
  const patch = (p: Partial<Rule>) => onChange({ ...rule, ...p });
  const currentSizes = detections.filter(d => d.className === rule.className &&
    d.confidence >= rule.confidence &&
    (!rule.region || rule.region === 'anywhere' || d.region === rule.region) &&
    d.areaRatio !== undefined).map(d => `${Math.round(d.areaRatio! * 100)}%`);
  const updateAction = (id: string, p: Partial<Action>) =>
    patch({ actions: rule.actions.map((a) => (a.id === id ? { ...a, ...p } : a)) });
  const reorder = (from: number, to: number) => {
    if (to < 0 || to >= rule.actions.length) return;
    const actions = [...rule.actions];
    const [a] = actions.splice(from, 1);
    actions.splice(to, 0, a);
    patch({ actions });
  };
  return (
    <article className={`rule-card ${!rule.enabled ? 'disabled-rule' : ''}`}>
      <div className="rule-heading">
        <span className="rule-number">{String(index + 1).padStart(2, '0')}</span>
        <input
          aria-label={`Rule ${index + 1} name`}
          value={rule.name}
          maxLength={100}
          onChange={(e) => patch({ name: e.target.value })}
        />
        <label className="switch small">
          <input
            type="checkbox"
            checked={rule.enabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
          />
          <span />
          Enabled
        </label>
        <button className="icon-button" aria-label={`Delete rule ${index + 1}`} onClick={onDelete}>
          <Trash2 size={16} />
        </button>
      </div>
      <div className="rule-body">
        <div className="condition">
          <span className="eyebrow">WHEN THIS HAPPENS</span>
          {!compatibleRule(rule, visionCapabilities) && <div role="status">
            <b>Needs update</b>
            <p>This model doesn't support Location or Near/Far.</p>
            <button onClick={() => onChange(classificationRule(rule))}>Convert to classification rule</button>
          </div>}
          {!visionCapabilities.boundingBoxes && <small>Image classification recognizes what the camera sees, but not where the object is located.</small>}
          <div className="sentence">
            <b className="keyword">IF</b>
            <select
              aria-label={visionCapabilities.boundingBoxes ? 'Detected class' : 'Class'}
              value={selectedClasses.includes(rule.className) ? rule.className : ''}
              onChange={(e) => patch({ className: e.target.value })}
            >
              {!selectedClasses.includes(rule.className) && <option value="" disabled>Choose class (current: {rule.className})</option>}
              {selectedClasses.map((c) => (
                <option key={c} value={c}>{objectLabel(c)}</option>
              ))}
            </select>
            <span>is detected</span>
          </div>
          {visionCapabilities.regions && <label>Location <select aria-label="Location" value={rule.region ?? 'anywhere'}
            onChange={e => patch({ region: e.target.value as Rule['region'] })}>
            {(['anywhere', 'left', 'center', 'right'] as const).map(region => <option key={region} value={region}>{objectLabel(region)}</option>)}
          </select></label>}
          {visionCapabilities.apparentDistance && <><label title="Estimated from how large the object appears in the camera.">
            Distance <select aria-label="Distance" value={rule.distance ?? 'any'}
              onChange={e => patch({ distance: e.target.value as Rule['distance'] })}>
              {(['any', 'far', 'near'] as const).map(distance =>
                <option key={distance} value={distance}>{objectLabel(distance)}</option>)}
            </select>
          </label>
          {(rule.distance ?? 'any') !== 'any' && <div>
            <label className="confidence">
              Near when object fills at least <b>{Math.round((rule.nearThreshold ?? 0.12) * 100)}%</b>
              <input aria-label="Near threshold" type="range" min={3} max={40} step={1}
                value={Math.round((rule.nearThreshold ?? 0.12) * 100)}
                onChange={e => patch({ nearThreshold: +e.target.value / 100 })} />
            </label>
            <small>Estimated from how large the object appears in the camera.</small>
            <div><small>{currentSizes.length
              ? `Current object ${currentSizes.length === 1 ? 'size' : 'sizes'}: ${currentSizes.join(', ')}`
              : 'No object meets the class, confidence, and location conditions.'}</small></div>
          </div>}
          </>}
          <label className="confidence">
            With confidence of at least <b>{Math.round(rule.confidence * 100)}%</b>
            <input
              aria-label="Rule confidence"
              type="range"
              min={10}
              max={100}
              value={rule.confidence * 100}
              onChange={(e) => patch({ confidence: +e.target.value / 100 })}
            />
          </label>
          <SensorConditions conditions={rule.sensorConditions ?? []} sensors={sensors} available={sensorsAvailable}
            onChange={sensorConditions => patch({ sensorConditions })} />
          <div className="trigger-pill">
            ↻{' '}
            {rule.mode === 'appearance'
              ? 'Once per appearance'
              : rule.mode === 'disappearance'
                ? 'When it disappears'
                : rule.mode === 'interval'
                  ? 'Every interval'
                  : 'While visible'}
          </div>
          <details>
            <summary>Timing & trigger settings</summary>
            <div className="timing">
              <label>
                Trigger
                <select
                  value={rule.mode}
                  onChange={(e) => patch({ mode: e.target.value as Rule['mode'] })}
                >
                <option value="appearance">Once per appearance</option>
                  <option value="continuous">While visible</option>
                  <option value="interval">Every N seconds</option>
                  <option value="disappearance">When object disappears</option>
                </select>
              </label>
              <label>
                Visible for (ms)
                <input
                  type="number"
                  min={0}
                  max={60000}
                  value={rule.minDuration}
                  onChange={(e) =>
                    patch({ minDuration: Math.max(0, Math.min(60000, +e.target.value)) })
                  }
                />
              </label>
              <label>
                Cooldown (ms)
                <input
                  type="number"
                  min={100}
                  max={60000}
                  value={rule.cooldown}
                  onChange={(e) =>
                    patch({ cooldown: Math.max(100, Math.min(60000, +e.target.value)) })
                  }
                />
              </label>
              {rule.mode === 'interval' && (
                <label>
                  Interval (ms)
                  <input
                    type="number"
                    min={100}
                    max={60000}
                    value={rule.interval}
                    onChange={(e) =>
                      patch({ interval: Math.max(100, Math.min(60000, +e.target.value)) })
                    }
                  />
                </label>
              )}
            </div>
          </details>
        </div>
        <div className="actions">
          <span className="eyebrow">MAKE THIS HAPPEN</span>
          <div className="then-label">
            <b className="keyword coral">THEN</b>
            <span>Run these actions in order</span>
          </div>
          {rule.actions.map((a, i) => (
            <div
              className={`action-card ${!a.enabled ? 'muted' : ''}`}
              key={a.id}
              draggable
              onDragStart={(e) => e.dataTransfer.setData('text/plain', `${rule.id}:${i}`)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const [id, from] = e.dataTransfer.getData('text/plain').split(':');
                if (id === rule.id && Number.isInteger(+from)) reorder(+from, i);
              }}
            >
              <GripVertical size={16} className="grip" />
              <span className="action-index">{i + 1}</span>
              <Lightbulb size={18} className="action-icon" />
              <div className="action-fields">
                <select
                  aria-label={`Action ${i + 1} type`}
                  value={capabilities.includes(a.kind) ? a.kind : ''}
                  onChange={(e) => updateAction(a.id, { ...makeAction(e.target.value as ActionKind), id: a.id, enabled: a.enabled })}
                >
                  {!capabilities.includes(a.kind) && <option value="" disabled>Choose an action</option>}
                  {capabilities.map((kind) => (
                    <option key={kind} value={kind}>
                      {kind === 'stop' && capabilities.includes('rotationServo') ? 'Stop outputs' : actionDefinitions[kind].label}
                    </option>
                  ))}
                </select>
                {!capabilities.includes(a.kind) && <small role="status">Not available for {robotName}</small>}
                {capabilities.includes(a.kind) && <>
                {portsFor(a.kind).length > 0 && <label>Port
                  <select aria-label={`Action ${i + 1} port`} value={a.port ?? 1} onChange={e => updateAction(a.id, { port: +e.target.value })}>
                    {portsFor(a.kind).map(port => <option key={port} value={port}>{port}</option>)}
                  </select>
                </label>}
                {a.kind === 'singleLed' && <label>Brightness %
                  <input aria-label={`Action ${i + 1} brightness`} type="number" min={0} max={100} value={a.brightness ?? 100}
                    onChange={e => updateAction(a.id, { brightness: Math.max(0, Math.min(100, +e.target.value)) })} />
                </label>}
                {a.kind === 'positionServo' && <label>Angle °
                  <input aria-label={`Action ${i + 1} angle`} type="number" min={0} max={180} value={a.angle ?? 90}
                    onChange={e => updateAction(a.id, { angle: Math.max(0, Math.min(180, +e.target.value)) })} />
                </label>}
                {(a.kind === 'beak' || a.kind === 'tail' || a.kind === 'triLed') && (
                  <label className="color-field">
                    Color
                    <input
                      aria-label={`Action ${i + 1} color`}
                      type="color"
                      value={a.color}
                      onChange={(e) => updateAction(a.id, { color: e.target.value })}
                    />
                    <span>{a.color.toUpperCase()}</span>
                  </label>
                )}
                {a.kind === 'tail' && <fieldset className="tail-light-picker">
                  <legend>Tail lights</legend>
                  {[1, 2, 3, 4].map(light => <label key={light}>
                    <input type="checkbox" aria-label={`Action ${i + 1} tail light ${light}`}
                      checked={(a.tailLights ?? [1, 2, 3, 4]).includes(light)}
                      onChange={e => updateAction(a.id, { tailLights: e.target.checked
                        ? [...(a.tailLights ?? [1, 2, 3, 4]), light]
                        : (a.tailLights ?? [1, 2, 3, 4]).filter(n => n !== light) })} />{light}
                  </label>)}
                  <small>Choose which lights receive this color. Others stay unchanged.</small>
                </fieldset>}
                {a.kind === 'tailLightSequence' && <fieldset className="tail-light-picker">
                  <legend>Tail light sequence</legend>
                  {[1, 2, 3, 4].map(light => {
                    const step = a.steps?.find(s => s.light === light);
                    return <div key={light} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <label><input type="checkbox" aria-label={`Action ${i + 1} sequence light ${light}`} checked={!!step}
                        onChange={e => updateAction(a.id, { steps: e.target.checked
                          ? [...(a.steps ?? []), sequenceDefaults().steps[light - 1]].sort((x, y) => x.light - y.light)
                          : (a.steps ?? []).filter(s => s.light !== light) })} />{light}</label>
                      <input type="color" aria-label={`Action ${i + 1} sequence light ${light} color`} disabled={!step}
                        value={step?.color ?? sequenceDefaults().steps[light - 1].color}
                        onChange={e => updateAction(a.id, { steps: a.steps!.map(s => s.light === light ? { ...s, color: e.target.value } : s) })} />
                    </div>;
                  })}
                  <label>Step speed (ms)<input type="number" min={50} max={10000} step={50} value={a.stepDurationMs ?? 250}
                    onChange={e => updateAction(a.id, { stepDurationMs: Math.max(50, Math.min(10000, Math.round(+e.target.value))) })} /></label>
                  <label>Repeat (times)<input type="number" min={1} max={20} value={a.repeatCount ?? 3}
                    onChange={e => updateAction(a.id, { repeatCount: Math.max(1, Math.min(20, Math.round(+e.target.value))) })} /></label>
                  <label><input type="checkbox" checked={a.clearPrevious ?? true} onChange={e => updateAction(a.id, { clearPrevious: e.target.checked })} />One light at a time</label>
                  <label><input type="checkbox" checked={a.clearWhenFinished ?? true} onChange={e => updateAction(a.id, { clearWhenFinished: e.target.checked })} />Turn sequence lights off when finished</label>
                </fieldset>}
                {(a.kind === 'move' || a.kind === 'rotationServo') && (
                  <>
                    <label>Movement
                      <select aria-label={`Action ${i + 1} movement mode`} value={a.mode ?? 'timed'}
                        onChange={e => updateAction(a.id, { ...(e.target.value === 'follow' ? FOLLOW_DEFAULTS : {}), mode: e.target.value as Action['mode'] })}>
                        <option value="timed">Timed</option>
                        <option value="continuous">Continuous while rule matches</option>
                        {a.kind === 'move' && <option value="follow" disabled={!visionCapabilities.boundingBoxes}>Follow detected target</option>}
                      </select>
                    </label>
                    {a.mode === 'follow' && <>
                      <small>Follow already adjusts position and distance automatically.</small>
                      {!visionCapabilities.boundingBoxes && <small role="status">Follow requires a model with bounding boxes.</small>}
                      <label>Follow speed %<input type="number" min={0} max={100} value={a.followSpeed ?? 35}
                        onChange={e => updateAction(a.id, { followSpeed: Math.max(0, Math.min(100, +e.target.value)) })} /></label>
                      <label>Follow distance<select value={a.followDistance ?? 'medium'} onChange={e => updateAction(a.id, { followDistance: e.target.value as Action['followDistance'] })}>
                        <option value="close">Close</option><option value="medium">Medium</option><option value="far">Far</option>
                      </select></label>
                      <details><summary>Advanced</summary>
                        <label>Steering sensitivity %<input type="number" min={0} max={100} value={a.steeringSensitivity ?? 50}
                          onChange={e => updateAction(a.id, { steeringSensitivity: Math.max(0, Math.min(100, +e.target.value)) })} /></label>
                        <label>Center tolerance %<input type="number" min={0} max={50} value={Math.round((a.centerDeadZone ?? 0.15) * 100)}
                          onChange={e => updateAction(a.id, { centerDeadZone: Math.max(0, Math.min(50, +e.target.value)) / 100 })} /></label>
                        <label>Lost target timeout (ms)<input type="number" min={100} max={3000} step={50} value={a.lostTargetTimeoutMs ?? 750}
                          onChange={e => updateAction(a.id, { lostTargetTimeoutMs: Math.max(100, Math.min(3000, +e.target.value)) })} /></label>
                      </details>
                    </>}
                    {a.mode !== 'follow' && <>
                    {a.mode === 'continuous'  && <small>Runs while this rule remains true.</small>}
                    <select
                      aria-label="Move direction"
                      value={a.direction}
                      onChange={(e) =>
                        updateAction(a.id, { direction: e.target.value as Action['direction'] })
                      }
                    >
                      {(a.kind === 'move' ? ['forward', 'backward', 'left', 'right'] : ['forward', 'backward']).map((d) => (
                        <option key={d} value={d}>{d === 'backward' && a.kind === 'rotationServo' ? 'Reverse' : objectLabel(d)}</option>
                      ))}
                    </select>
                    <label>
                      Speed %
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={a.speed}
                        onChange={(e) =>
                          updateAction(a.id, { speed: Math.max(0, Math.min(100, +e.target.value)) })
                        }
                      />
                    </label>
                    </>}
                  </>
                )}
                {a.kind === 'sound' && (
                  <select
                    aria-label="Note"
                    value={a.note}
                    onChange={(e) => updateAction(a.id, { note: e.target.value })}
                  >
                    {['C4', 'E4', 'G4', 'C5', 'D5', 'E5', 'G5'].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                )}
                {(['wait', 'sound'].includes(a.kind) || (['move', 'rotationServo'].includes(a.kind) && a.mode !== 'continuous' && a.mode !== 'follow')) && (
                  <label>
                    Duration (ms)
                    <input
                      type="number"
                      min={0}
                      max={10000}
                      value={a.duration}
                      onChange={(e) =>
                        updateAction(a.id, {
                          duration: Math.max(0, Math.min(10000, +e.target.value)),
                        })
                      }
                    />
                  </label>
                )}
                </>}
              </div>
              <div className="action-tools">
                <input
                  aria-label={`Enable action ${i + 1}`}
                  type="checkbox"
                  checked={a.enabled}
                  onChange={(e) => updateAction(a.id, { enabled: e.target.checked })}
                />
                <button
                  aria-label={`Move action ${i + 1} up`}
                  disabled={i === 0}
                  onClick={() => reorder(i, i - 1)}
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  aria-label={`Move action ${i + 1} down`}
                  disabled={i === rule.actions.length - 1}
                  onClick={() => reorder(i, i + 1)}
                >
                  <ArrowDown size={13} />
                </button>
                <button
                  aria-label={`Delete action ${i + 1}`}
                  onClick={() => patch({ actions: rule.actions.filter((x) => x.id !== a.id) })}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
          <button
            className="add-action"
            disabled={rule.actions.length >= 30}
            onClick={() => patch({ actions: [...rule.actions, makeAction(capabilities[0])] })}
          >
            <Plus size={15} />
            Add action
          </button>
        </div>
      </div>
    </article>
  );
}




