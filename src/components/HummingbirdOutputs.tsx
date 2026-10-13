import { useState } from 'react';
import { makeAction, type Action, type ActionKind, type ServoHome } from '../core/types';
import { portsFor } from '../core/RobotCapabilities';
import { DEFAULT_SERVO_HOME, servoHomeAction } from '../core/HummingbirdClassroom';
import { NumericSlider } from './NumericSlider';
export function HummingbirdOutputs({ home = DEFAULT_SERVO_HOME, onHomeChange, connected, busy, onAction, onStop }: {
  home?: ServoHome; onHomeChange?: (home: ServoHome) => void; connected: boolean; busy: boolean;
  onAction: (action: Action) => void; onStop: () => void;
}) {
  const [kind, setKind] = useState<ActionKind>('positionServo');
  const [port, setPort] = useState(1), [angle, setAngle] = useState(90);
  const [brightness, setBrightness] = useState(100), [color, setColor] = useState('#0000ff');
  const [speed, setSpeed] = useState(25);
  const blocked = !connected || busy;
  return <section aria-label="Hummingbird setup and tests">
    <div className="base-settings"><strong>Servo Home</strong>
      <label>Port<select aria-label="Servo Home port" value={home.port} disabled={busy} onChange={e => onHomeChange?.({ ...home, port: +e.target.value })}>{[1,2,3,4].map(p => <option key={p}>{p}</option>)}</select></label>
      <label>Angle<NumericSlider aria-label="Servo Home angle" min={0} max={180} value={home.angle} disabled={busy} onChange={e => onHomeChange?.({ ...home, angle: Math.max(0, Math.min(180, +e.target.value)) })} /></label>
      <button disabled={blocked} onClick={() => onAction(servoHomeAction(home))}>Move Home</button>
    </div>
    <details className="compact-advanced"><summary>Test outputs</summary>
      <div className="base-settings">
        <label>Output<select aria-label="Test output" value={kind} disabled={busy} onChange={e => { setKind(e.target.value as ActionKind); setPort(1); }}>
          <option value="positionServo">Position Servo</option><option value="singleLed">LED</option><option value="triLed">Tri-color LED</option><option value="rotationServo">Motor (rotation servo)</option>
        </select></label>
        <label>Port<select aria-label="Test output port" value={port} disabled={busy} onChange={e => setPort(+e.target.value)}>{portsFor(kind).map(p => <option key={p}>{p}</option>)}</select></label>
        {kind === 'positionServo' && <label>Angle<NumericSlider aria-label="Test servo angle" min={0} max={180} value={angle} disabled={busy} onChange={e => setAngle(Math.max(0, Math.min(180, +e.target.value)))} /></label>}
        {kind === 'singleLed' && <label>Brightness<NumericSlider aria-label="Test LED brightness" min={0} max={100} value={brightness} disabled={busy} onChange={e => setBrightness(Math.max(0, Math.min(100, +e.target.value)))} /></label>}
        {kind === 'triLed' && <label>Color<input aria-label="Test Tri-color LED color" type="color" value={color} disabled={busy} onChange={e => setColor(e.target.value)} /></label>}
        {kind === 'rotationServo' && <label>Speed %<NumericSlider aria-label="Test motor speed" min={0} max={100} value={speed} disabled={busy} onChange={e => setSpeed(Math.max(0, Math.min(100, +e.target.value)))} /><small>Forward for 500 ms</small></label>}
        <button disabled={blocked} onClick={() => onAction({ ...makeAction(kind), port, angle, brightness, color, speed, duration: 500 })}>Test output</button>
        <button className="stop-button" onClick={onStop}>STOP</button>
      </div>
    </details>
  </section>;
}
