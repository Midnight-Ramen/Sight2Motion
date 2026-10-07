import { EncoderRecording, encoderPair } from '../core/EncoderRecording';
import type { SensorState } from '../core/Sensors';
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react';
import { NumericSlider } from './NumericSlider';
import { makeAction, makeRule, type Action } from '../core/types';
import type { ActionEngine } from '../core/ActionEngine';

const EMPTY_SENSORS: SensorState = {};
type Direction = Action['direction'];
export const driveKeys: Readonly<Record<string, Direction>> = {
  w: 'forward', ArrowUp: 'forward', s: 'backward', ArrowDown: 'backward',
  a: 'left', ArrowLeft: 'left', d: 'right', ArrowRight: 'right',
};
const editing = (target: EventTarget | null) => target instanceof Element &&
  !!target.closest('input, select, textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"]');

export function ManualDrive({ engine, connected, running, busy, open, stopRevision = 0, sensors = EMPTY_SENSORS }: {
  sensors?: SensorState; stopRevision?: number;
  engine: ActionEngine; connected: boolean; running: boolean; busy: boolean; open: boolean;
}) {
  const [recording] = useState(() => new EncoderRecording());
  const [, refresh] = useState(0);
  const readings = useRef(sensors); readings.current = sensors;
  const pair = () => encoderPair(readings.current, performance.now());
  useEffect(() => {
    if (!connected) recording.clear();
    else recording.observe(pair());
    refresh(value => value + 1);
  }, [sensors, connected, recording]);
  useEffect(() => { recording.stop(pair()); }, [stopRevision, recording]);
  const [speed, setSpeed] = useState(30);
  const [direction, setDirection] = useState<Direction | null>(null);
  const held = useRef<string | null>(null);
  const current = useRef({ speed, enabled: false });
  current.current = { speed, enabled: connected && !running && !busy && open };
  const stop = () => {
    if (held.current === null) return;
    recording.stop(pair());
    held.current = null;
    setDirection(null);
    void engine.stop();
  };
  const start = (next: Direction, token: string) => {
    if (!current.current.enabled || held.current !== null || editing(document.activeElement) || document.hidden) return false;
    held.current = token;
    setDirection(next);
    recording.begin(next, pair());
    // Ephemeral owner only: reuse continuous action ownership, cancellation and watchdog.
    const rule = { ...makeRule(), id: `manual-drive-${crypto.randomUUID()}`, actions: [
      { ...makeAction('move'), mode: 'continuous' as const, direction: next, speed: current.current.speed },
    ] };
    void engine.updateRules([rule], [rule]).then(ok => { if (!ok && held.current === token) stop(); }).catch(() => stop());
    return true;
  };
  useEffect(() => {
    if (!current.current.enabled) stop();
  }, [connected, running, busy, open]);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Space') { stop(); return; } // App retains global emergency STOP.
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const next = driveKeys[key];
      if (!next || editing(event.target) || event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.repeat) { if (held.current === key) event.preventDefault(); return; }
      if (start(next, key)) event.preventDefault();
    };
    const up = (event: KeyboardEvent) => {
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (driveKeys[key] && held.current !== null) stop();
    };
    const hidden = () => { if (document.hidden) stop(); };
    const focus = (event: FocusEvent) => { if (editing(event.target)) stop(); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', hidden);
    document.addEventListener('focusin', focus);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', hidden);
      document.removeEventListener('focusin', focus);
      stop();
    };
  }, [engine]);
  return <section className="manual-drive" aria-label="Manual Drive">
    <h3>Manual Drive</h3>
    <div className="home-controls">
      <button disabled={!connected || running || busy || direction !== null || !pair()} onClick={() => { recording.setHome(pair()); refresh(value => value + 1); }}>Set Home</button>
      <button disabled={!recording.origin} onClick={() => { recording.clear(); refresh(value => value + 1); }}>Clear Home</button>
    </div>
    <small aria-label="Encoder recording">Home: {recording.origin ? 'Set' : 'Not set'} · Δ Left: {format(recording.relative(pair())?.left)} · Δ Right: {format(recording.relative(pair())?.right)} · Segments: {recording.segments.length}</small>
    <label>Speed %<NumericSlider aria-label="Manual drive speed" min={0} max={100} step={1} value={speed}
      onChange={event => setSpeed(Math.max(0, Math.min(100, +event.target.value)))} /></label>
    <div className="manual-drive-pad">
      {([['forward', ArrowUp], ['left', ArrowLeft], ['backward', ArrowDown], ['right', ArrowRight]] as const).map(([value, Icon]) =>
        <button key={value} className={`drive-${value}`} aria-label={`Drive ${value}`} aria-pressed={direction === value}
          disabled={!current.current.enabled}
          onPointerDown={event => {
            if (event.button !== 0) return;
            // Focus the button before checking input focus, just as a normal pointer click does.
            event.currentTarget.focus();
            if (start(value, `pointer-${event.pointerId}`)) event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}>
          <Icon size={18} />
        </button>)}
    </div>
    <small>{running ? 'Stop rules to drive manually.' : !connected ? 'Connect Finch to drive manually.' : 'Arrow Keys / WASD · Hold to move, release to stop.'}</small>
  </section>;
}

function format(value: number | undefined) { return value === undefined ? 'No data' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}`; }
