import { ArrowDown, ArrowUp, GripVertical, Lightbulb, Plus, Trash2 } from 'lucide-react';
import {
  actionDefinitions,
  makeAction,
  sequenceDefaults,
  type Action,
  type ActionKind,
  type Rule,
} from '../core/types';
import { objectLabel } from '../core/ProjectObjects';
export function RuleCard({
  rule,
  index,
  onChange,
  onDelete,
  capabilities,
  selectedClasses,
}: {
  selectedClasses: string[];
  rule: Rule;
  index: number;
  onChange: (r: Rule) => void;
  onDelete: () => void;
  capabilities: ActionKind[];
}) {
  const patch = (p: Partial<Rule>) => onChange({ ...rule, ...p });
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
          <div className="sentence">
            <b className="keyword">IF</b>
            <select
              aria-label="Detected class"
              value={rule.className}
              onChange={(e) => patch({ className: e.target.value })}
            >
              {selectedClasses.map((c) => (
                <option key={c} value={c}>{objectLabel(c)}</option>
              ))}
            </select>
            <span>is detected</span>
          </div>
          <label>Location <select aria-label="Location" value={rule.region ?? 'anywhere'}
            onChange={e => patch({ region: e.target.value as Rule['region'] })}>
            {(['anywhere', 'left', 'center', 'right'] as const).map(region => <option key={region} value={region}>{objectLabel(region)}</option>)}
          </select></label>
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
                  value={a.kind}
                  onChange={(e) => updateAction(a.id, { kind: e.target.value as ActionKind, ...(e.target.value === 'tail' ? { tailLights: [] } : {}), ...(e.target.value === 'tailLightSequence' ? sequenceDefaults() : {}) })}
                >
                  {capabilities.map((kind) => (
                    <option key={kind} value={kind}>
                      {actionDefinitions[kind].label}
                    </option>
                  ))}
                </select>
                {(a.kind === 'beak' || a.kind === 'tail') && (
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
                {a.kind === 'move' && (
                  <>
                    <select
                      aria-label="Move direction"
                      value={a.direction}
                      onChange={(e) =>
                        updateAction(a.id, { direction: e.target.value as Action['direction'] })
                      }
                    >
                      {['forward', 'backward', 'left', 'right'].map((d) => (
                        <option key={d}>{d}</option>
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
                {['move', 'wait', 'sound'].includes(a.kind) && (
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
            onClick={() => patch({ actions: [...rule.actions, makeAction()] })}
          >
            <Plus size={15} />
            Add action
          </button>
        </div>
      </div>
    </article>
  );
}




