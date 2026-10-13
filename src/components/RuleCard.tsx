import { NumericInput } from './NumericInput';
import { homeAngleForPort } from '../core/HummingbirdClassroom';
import type { ServoHome } from '../core/types';
import { NumericSlider } from './NumericSlider';
import { useId, useState } from 'react';
import { ActionIcon } from './ActionIcon';
import { ruleSummary } from './RuleSummary';
import { completeRule, type CompletionProblem } from './RuleCompletion';
import { ArrowDown, ArrowUp, GripVertical, ChevronDown, Plus, Trash2, Check } from 'lucide-react';
import {
  actionDefinitions,
  ruleSource,
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
import { isDrivingReaction } from '../core/DrivingReactions';
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
  guidance,
  servoHome,
}: {
  servoHome?: ServoHome;
  guidance?: string;
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
  const [expanded, setExpanded] = useState(true);
  const [completionProblem, setCompletionProblem] = useState<CompletionProblem>();
  const editorId = useId();
  const done = () => {
    const result = completeRule(rule, sensors, selectedClasses, capabilities, visionCapabilities);
    setCompletionProblem(result.problem);
    if (!result.expanded) { onChange(result.rule); setExpanded(false); }
  };
  const source = ruleSource(rule);
  const sensorOnly = source === 'sensor';
  const patch = (p: Partial<Rule>) => { setCompletionProblem(undefined); onChange({ ...rule, ...p }); };
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
        <strong className="rule-title">{ruleSummary(rule, sensors, true)}</strong>
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
        <button className={`rule-edit ${expanded ? 'rule-done' : ''}`} aria-expanded={expanded} aria-controls={editorId} onClick={() => expanded ? done() : setExpanded(true)}>
          {expanded && <Check size={16} aria-hidden="true" />}{expanded ? 'Done' : 'Edit'}<ChevronDown size={16} style={{ transform: expanded ? 'rotate(180deg)' : undefined }} />
        </button>
      </div>
      <div id={editorId} hidden={!expanded}>
      <details className="compact-advanced saved-rule-name"><summary>Saved name</summary><small>{rule.name}</small></details>
      {completionProblem?.area === 'settings' && <p className="rule-validation" role="alert">{completionProblem.message}</p>}
      {!completionProblem && guidance && compatibleRule(rule, visionCapabilities) && <p role="status">{guidance}</p>}
      <div className="rule-body">
        <div className="condition">
          <span className="eyebrow">WHEN THIS HAPPENS</span>
          <label className="sentence condition-source">Condition <select aria-label="Condition source" value={source} onChange={e => patch({
            source: e.target.value as Rule['source'],
            ...(e.target.value === 'vision' ? { sensorConditions: [] } : {}),
            ...(e.target.value === 'sensor' ? { className: '', region: 'anywhere', distance: 'any' } : {}),
          })}>
            <option value="vision">Vision</option><option value="sensor">Sensor</option><option value="vision-sensor">Vision + Sensor</option>
          </select></label>
          {(completionProblem?.area === 'object' || completionProblem?.area === 'sensor') && <small className="rule-validation" role="alert">{completionProblem.message}</small>}
          {!compatibleRule(rule, visionCapabilities) && <div role="status">
            <b>Needs update</b>
            <p>This rule needs bounding boxes. Choose object detection or convert to a classification rule.</p>
            <button onClick={() => onChange(classificationRule(rule))}>Convert to classification rule</button>
          </div>}
          {!sensorOnly && <>
          {!visionCapabilities.boundingBoxes && <small>Image classification recognizes what the camera sees, but not where the object is located.</small>}
          <div className="sentence">
            <b className="keyword">IF</b>
            <select
              className="object-select"
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
          <div className="spatial-controls">
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
          </>}
          </div>
          {visionCapabilities.apparentDistance && <>
          {(rule.distance ?? 'any') !== 'any' && <div>
            <label className="confidence">
              Near when object fills at least <b>{Math.round((rule.nearThreshold ?? 0.12) * 100)}%</b>
              <NumericSlider aria-label="Near threshold" type="range" min={3} max={40} step={1}
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
            <NumericSlider
              aria-label="Rule confidence"
              type="range"
              min={10}
              max={100}
              value={rule.confidence * 100}
              onChange={(e) => patch({ confidence: +e.target.value / 100 })}
            />
          </label>
          </>}
          {source !== 'vision' && <SensorConditions sensorOnly={sensorOnly} conditions={rule.sensorConditions ?? []} sensors={sensors} available={sensorsAvailable}
            onChange={sensorConditions => patch({ sensorConditions })} />}
          <div className="condition-footer">
          <div className="trigger-pill">
            ↻{' '}
            {rule.mode === 'appearance'
              ? sensorOnly ? 'When condition becomes true' : 'Once per detection'
              : rule.mode === 'disappearance'
                ? sensorOnly ? 'When condition becomes false' : 'When it disappears'
                : rule.mode === 'interval'
                  ? 'Every interval'
                  : sensorOnly ? 'While true' : 'While visible'}
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
                <option value="appearance">{sensorOnly ? 'When condition becomes true' : 'Once per detection'}</option>
                  <option value="continuous">{sensorOnly ? 'While true' : 'While visible'}</option>
                  <option value="interval">Every N seconds</option>
                  <option value="disappearance">{sensorOnly ? 'When condition becomes false' : 'When object disappears'}</option>
                </select>
              </label>
              <label>
                {sensorOnly ? 'True for (ms)' : 'Visible for (ms)'}
                <NumericInput
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
                <NumericInput
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
                  <NumericInput
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
        </div>
        <div className="actions">
          <span className="eyebrow">MAKE THIS HAPPEN</span>
          {completionProblem?.area === 'action' && <small className="rule-validation" role="alert">{completionProblem.message}</small>}
          <div className="then-label">
            <b className="keyword coral">THEN</b>
            <span>Run these actions in order</span>
          </div>
          {rule.actions.map((a, i) => (
            <div
              className={`action-card ${!a.enabled ? 'muted' : ''}`}
              key={a.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const [id, from] = e.dataTransfer.getData('text/plain').split(':');
                if (id === rule.id && Number.isInteger(+from)) reorder(+from, i);
              }}
            >
              <span className="action-drag" draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', `${rule.id}:${i}`)} title="Drag to reorder action"><GripVertical size={16} className="grip" /></span>
              <span className="action-index">{i + 1}</span>
              <span className="action-icon"><ActionIcon action={a} /></span>
              <div className="action-fields">
                <select
                  aria-label={`Action ${i + 1} type`}
                  value={capabilities.includes(a.kind) ? a.kind === 'move' && a.mode === 'timed' && ['left', 'right'].includes(a.direction) ? `turn-${a.direction}` : a.kind : ''}
                  onChange={(e) => { const turn = e.target.value.startsWith('turn-'); updateAction(a.id, { ...makeAction(turn ? 'move' : e.target.value as ActionKind), ...(turn ? { direction: e.target.value === 'turn-left' ? 'left' as const : 'right' as const } : {}), id: a.id, enabled: a.enabled, returnHome: undefined }); }}
                >
                  {!capabilities.includes(a.kind) && <option value="" disabled>Choose an action</option>}
                  {capabilities.includes('move') && <optgroup label="Driving">
                    {(['stop', 'slowDown', 'setSpeed', 'veerLeft', 'veerRight', 'avoidObstacle'] as ActionKind[]).filter(kind => capabilities.includes(kind)).map(kind => <option key={kind} value={kind}>{kind === 'stop' ? 'Stop' : actionDefinitions[kind].label}</option>)}
                    <option value="turn-left">Turn Left</option><option value="turn-right">Turn Right</option>
                    {capabilities.includes('resumeBase') && <option value="resumeBase">Resume Base</option>}
                    <option value="move">Move</option>
                  </optgroup>}
                  <optgroup label="Signals">
                  {capabilities.filter(kind => !capabilities.includes('move') || (kind !== 'move' && kind !== 'stop' && !isDrivingReaction({ ...a, kind }))).map((kind) => (
                    <option key={kind} value={kind}>
                      {kind === 'stop' && capabilities.includes('rotationServo') ? 'Stop outputs' : actionDefinitions[kind].label}
                    </option>
                  ))}
                  </optgroup>
                </select>
                {!capabilities.includes(a.kind) && <small role="status">Not available for {robotName}</small>}
                {capabilities.includes(a.kind) && <>
                {a.kind === 'avoidObstacle' && <small>Uses this rule’s Distance threshold. Cruise Forward only.</small>}
                {(a.kind === 'slowDown' || a.kind === 'setSpeed') && <label>Speed %
                  <NumericSlider aria-label={`Action ${i + 1} speed`} min={1} max={100} value={a.speed}
                    onChange={e => updateAction(a.id, { speed: Math.max(1, Math.min(100, +e.target.value)) })} />
                </label>}
                {portsFor(a.kind).length > 0 && <label>Port
                  <select aria-label={`Action ${i + 1} port`} value={a.port ?? 1} onChange={e => updateAction(a.id, { port: +e.target.value })}>
                    {portsFor(a.kind).map(port => <option key={port} value={port}>{port}</option>)}
                  </select>
                </label>}
                {a.kind === 'singleLed' && <label>Brightness %
                  <NumericSlider aria-label={`Action ${i + 1} brightness`} type="number" min={0} max={100} value={a.brightness ?? 100}
                    onChange={e => updateAction(a.id, { brightness: Math.max(0, Math.min(100, +e.target.value)) })} />
                </label>}
                {a.kind === 'positionServo' && <label>Angle °
                  <NumericSlider aria-label={`Action ${i + 1} angle`} type="number" min={0} max={180} value={a.angle ?? 90}
                    onChange={e => updateAction(a.id, { angle: Math.max(0, Math.min(180, +e.target.value)) })} />
                </label>}
                {a.kind === 'positionServo' && <label><input type="checkbox" checked={a.returnHome ?? false}
                  onChange={event => updateAction(a.id, { returnHome: event.target.checked })} />Return Home
                  <small>Port {a.port ?? 1}: {homeAngleForPort(servoHome, a.port ?? 1)} degrees. Add Wait immediately after this action to hold before returning.</small>
                </label>}
                {(a.kind === 'beak' || a.kind === 'triLed') && (
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
                  <div className="tail-led-row">{([1, 2, 3, 4] as const).map(light => <div className="tail-led-control" key={light}>
                    <label><input type="checkbox" aria-label={`Action ${i + 1} tail light ${light}`}
                      checked={(a.tailLights ?? [1, 2, 3, 4]).includes(light)}
                      onChange={e => updateAction(a.id, { tailLights: e.target.checked
                        ? [...(a.tailLights ?? [1, 2, 3, 4]), light]
                        : (a.tailLights ?? [1, 2, 3, 4]).filter(n => n !== light) })} />{light}</label>
                    <input type="color" aria-label={`Action ${i + 1} tail light ${light} color`}
                      disabled={!(a.tailLights ?? [1, 2, 3, 4]).includes(light)}
                      value={a.tailColors?.[light] ?? a.color}
                      onChange={e => updateAction(a.id, { tailColors: { ...a.tailColors, [light]: e.target.value } })} />
                  </div>)}</div>
                  <small>Choose which lights receive this color. Others stay unchanged.</small>
                </fieldset>}
                {a.kind === 'tailLightSequence' && <fieldset className="tail-light-picker">
                  <legend>Tail light sequence</legend>
                  <div className="tail-led-row">{[1, 2, 3, 4].map(light => {
                    const step = a.steps?.find(s => s.light === light);
                    return <div key={light} className="tail-led-control">
                      <label><input type="checkbox" aria-label={`Action ${i + 1} sequence light ${light}`} checked={!!step}
                        onChange={e => updateAction(a.id, { steps: e.target.checked
                          ? [...(a.steps ?? []), sequenceDefaults().steps[light - 1]].sort((x, y) => x.light - y.light)
                          : (a.steps ?? []).filter(s => s.light !== light) })} />{light}</label>
                      <input type="color" aria-label={`Action ${i + 1} sequence light ${light} color`} disabled={!step}
                        value={step?.color ?? sequenceDefaults().steps[light - 1].color}
                        onChange={e => updateAction(a.id, { steps: a.steps!.map(s => s.light === light ? { ...s, color: e.target.value } : s) })} />
                    </div>;
                  })}</div>
                  <div className="tail-timing"><label>Step speed (ms)<NumericInput type="number" min={50} max={10000} step={50} value={a.stepDurationMs ?? 250}
                    onChange={e => updateAction(a.id, { stepDurationMs: Math.max(50, Math.min(10000, Math.round(+e.target.value))) })} /></label>
                  <label>Repeat (times)<NumericInput type="number" min={1} max={20} value={a.repeatCount ?? 3}
                    onChange={e => updateAction(a.id, { repeatCount: Math.max(1, Math.min(20, Math.round(+e.target.value))) })} /></label>
                  </div>
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
                        {a.kind === 'move' && <option value="follow" disabled={sensorOnly || !visionCapabilities.boundingBoxes}>Follow detected target</option>}
                      </select>
                    </label>
                    {a.mode === 'follow' && <>
                      <small>Follow already adjusts position and distance automatically.</small>
                      {!visionCapabilities.boundingBoxes && <small role="status">Follow requires a model with bounding boxes.</small>}
                      <label>Follow speed %<NumericSlider aria-label="Follow speed %" type="number" min={0} max={100} value={a.followSpeed ?? 35}
                        onChange={e => updateAction(a.id, { followSpeed: Math.max(0, Math.min(100, +e.target.value)) })} /></label>
                      <label>Follow distance<select value={a.followDistance ?? 'medium'} onChange={e => updateAction(a.id, { followDistance: e.target.value as Action['followDistance'] })}>
                        <option value="close">Close</option><option value="medium">Medium</option><option value="far">Far</option>
                      </select></label>
                      <details><summary>Advanced</summary>
                        <label>Steering sensitivity %<NumericSlider aria-label="Steering sensitivity %" type="number" min={0} max={100} value={a.steeringSensitivity ?? 50}
                          onChange={e => updateAction(a.id, { steeringSensitivity: Math.max(0, Math.min(100, +e.target.value)) })} /></label>
                        <label>Center tolerance %<NumericSlider aria-label="Center tolerance %" type="number" min={0} max={50} value={Math.round((a.centerDeadZone ?? 0.15) * 100)}
                          onChange={e => updateAction(a.id, { centerDeadZone: Math.max(0, Math.min(50, +e.target.value)) / 100 })} /></label>
                        <label>Lost target timeout (ms)<NumericInput type="number" min={100} max={3000} step={50} value={a.lostTargetTimeoutMs ?? 750}
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
                      <NumericSlider aria-label="Speed %"
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
                    <NumericInput
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
      </div>
    </article>
  );
}




