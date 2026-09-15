import { FinchPhoto } from './FinchView';
import type { RobotStatus } from '../core/RobotAdapter';
import type { Action, RobotType } from '../core/types';
import { ROBOTS, manualTests } from '../core/RobotCapabilities';
export function HardwareTest({
  status,
  robotType,
  busy,
  onAttach,
  onDisconnect,
  onAction,
  onStop,
  onReset,
}: {
  status: RobotStatus;
  robotType: RobotType;
  busy: boolean;
  onAttach: () => void;
  onDisconnect: () => void;
  onAction: (action: Action) => void;
  onStop: () => void;
  onReset: () => void;
}) {
  const connected = status.connection === 'connected';
  const name = ROBOTS[robotType].name;
  return (
    <div className="hardware-test">
      {robotType === 'finch' ? <FinchPhoto /> : <div className="finch-photo-frame"><img className="finch-photo" src={`${import.meta.env.BASE_URL}hummingbird-bit.png`} alt="Hummingbird Bit and micro:bit" /></div>}
      <h3>Hardware test · {name} A</h3>
      <dl>
        <div>
          <dt>BirdBrain Connector</dt>
          <dd>{status.connector === 'detected' ? 'Detected' : 'Not detected'}</dd>
        </div>
        <div>
          <dt>{name}</dt>
          <dd>
            {connected
              ? 'Connected'
              : status.connection === 'connecting'
                ? 'Connecting…'
                : 'Disconnected'}
          </dd>
        </div>
      </dl>
      <p role="status">{status.message}</p>
      <button disabled={busy} onClick={connected ? onDisconnect : onAttach}>
        {status.connection === 'connecting'
          ? 'Checking…'
          : connected
            ? 'Disconnect from app'
            : `Attach to ${name} A`}
      </button>
      <div className="hardware-test-buttons">
        {manualTests(robotType).map(test => <button key={test.label} disabled={!connected || busy} onClick={() => onAction(test.action)}>{test.label}</button>)}
        <button className="stop-button" onClick={onStop}>
          STOP
        </button>
      </div>
      <button disabled={busy} onClick={onReset}>Reset project</button>
      <p>Reset deletes all rules and sensor conditions. When connected, lights turn off and motion stops. {robotType === 'hummingbird' && 'Position servos return to 90°. '}Save a project file first to keep your work.</p>
      <p>
        Connect {name} as A in BlueBird first. Test only the outputs you have connected.
      </p>
      <p>
        HTTP responses confirm a request, not physical motion. Observe the robot. If communication
        fails while moving, use its power button.
      </p>
    </div>
  );
}

